// FILE: pullRequestDetail.logic.ts
// Purpose: Pure helpers shared by every host of the pull request detail surface (the inbox
//          route's detail pane and the chat right-dock pane): the canonical
//          pane identity key, the "PR #n" tab chip label, the plain-language state
//          descriptor, and the flattened chronological timeline event list.
// Layer: Web domain helpers (no React)
// Exports: pullRequestDetailInputKey, pullRequestPaneTabLabel, pullRequestDetailInputFromPane,
//          describePullRequestState, stripHtmlComments, PullRequestTimelineEvent,
//          buildPullRequestTimelineEvents

import { msg } from "@lingui/core/macro";
import type {
  PullRequestDetail,
  PullRequestDetailInput,
  PullRequestState,
} from "@synara/contracts";

import { i18n } from "~/i18n";
import type { RightDockPane } from "~/rightDockStore.logic";

import { pullRequestMarkdownPreview } from "./pullRequestMarkdown.logic";

/** Canonical identity for one detail surface — used as the React key so switching the
 *  selected pull request remounts the panel (resetting its tab and diff state). */
export function pullRequestDetailInputKey(input: PullRequestDetailInput): string {
  return `${input.projectId}:${input.repository}#${input.number}`;
}

/** Tab chip label for the right-dock pane tab. */
export function pullRequestPaneTabLabel(number: number): string {
  return `PR #${number}`;
}

/** The detail input a dock "pullRequest" pane points at, or null while the pane is empty.
 *  Single owner of the identity-fields guard so every pane consumer (content, tab icon)
 *  validates the same way. */
export function pullRequestDetailInputFromPane(pane: RightDockPane): PullRequestDetailInput | null {
  if (
    pane.kind !== "pullRequest" ||
    !pane.pullRequestProjectId ||
    !pane.pullRequestRepository ||
    !pane.pullRequestNumber
  ) {
    return null;
  }
  return {
    projectId: pane.pullRequestProjectId,
    repository: pane.pullRequestRepository,
    number: pane.pullRequestNumber,
  };
}

// Plain-language state descriptor shown next to the author line — the state color itself is
// already conveyed by the PullRequestStateGlyph in the header, so this stays neutral text.
// State only, matching git: conflicts are a merge signal and render as their own row.
export function describePullRequestState(state: PullRequestState, isDraft: boolean): string {
  if (isDraft && state === "open") return i18n._("Draft");
  if (state === "open") return i18n._("Ready for review");
  if (state === "merged") return i18n._("Merged");
  return i18n._("Closed");
}

// stripHtmlComments now lives with the rest of the markdown preprocessing.
export { stripHtmlComments } from "./pullRequestMarkdown.logic";

export interface PullRequestTimelineEvent {
  id: string;
  /** ISO timestamp the event sorts by. */
  at: string;
  title: string;
  body: string | null;
}

/** How the app names a GitHub person: the display name, else the login. Null when neither is
 *  known (a deleted account); each surface picks its own word for that case. */
export function githubActorName(
  actor: { login?: string | null; name?: string | null } | null | undefined,
): string | null {
  return actor?.name?.trim() || actor?.login?.trim() || null;
}

/** A pull request's timeline source; issues have no commits and no merge. */
export type GitHubItemTimelineSource = Pick<
  PullRequestDetail,
  "createdAt" | "author" | "comments" | "closedAt"
> &
  Partial<Pick<PullRequestDetail, "commits" | "mergedAt">>;

/** Flattens creation, commits, comments/reviews, and the terminal merge/close event into one
 *  chronologically sorted list. Merged wins over closed: GitHub sets both timestamps on a
 *  merge, and showing "closed" for a merged pull request would misstate what happened. */
export function buildPullRequestTimelineEvents(
  detail: GitHubItemTimelineSource,
  noun?: "pull request" | "issue",
): PullRequestTimelineEvent[] {
  const isIssue = noun === "issue";
  const mergedAt = detail.mergedAt ?? null;
  const someone = i18n._("Someone");
  const opener = githubActorName(detail.author) ?? someone;
  const events: PullRequestTimelineEvent[] = [
    {
      id: "created",
      at: detail.createdAt,
      title: isIssue
        ? i18n._("{name} opened this issue", { name: opener })
        : i18n._("{name} opened this pull request", { name: opener }),
      body: null,
    },
    ...(detail.commits ?? []).map((commit) => {
      const authorLabel = commit.authors.map(githubActorName).find((name) => name !== null);
      return {
        id: commit.oid,
        at: commit.committedDate,
        title: authorLabel
          ? i18n._("Commit {sha} by {name}", { sha: commit.oid.slice(0, 7), name: authorLabel })
          : i18n._("Commit {sha}", { sha: commit.oid.slice(0, 7) }),
        body: commit.messageHeadline || i18n._("No commit message."),
      };
    }),
    ...detail.comments.map((comment) => ({
      id: comment.id,
      at: comment.createdAt,
      title:
        comment.kind === "review"
          ? i18n._("{name} reviewed", { name: githubActorName(comment.author) ?? someone })
          : i18n._("{name} commented", { name: githubActorName(comment.author) ?? someone }),
      // Timeline previews are plain text, so raw markdown/HTML would print literally.
      body: pullRequestMarkdownPreview(comment.body) || null,
    })),
    ...(mergedAt
      ? [
          {
            id: "merged",
            at: mergedAt,
            title: isIssue ? i18n._("Issue merged") : i18n._("Pull request merged"),
            body: null,
          },
        ]
      : []),
    ...(detail.closedAt && !mergedAt
      ? [
          {
            id: "closed",
            at: detail.closedAt,
            title: isIssue ? i18n._("Issue closed") : i18n._("Pull request closed"),
            body: null,
          },
        ]
      : []),
  ];
  return events.toSorted((left, right) => left.at.localeCompare(right.at));
}

export type PullRequestMergeStatusTone = "success" | "conflict" | "muted";

/** The Merge status line of the detail's info column, from what GitHub reports. */
export function describePullRequestMergeStatus(
  detail: Pick<PullRequestDetail, "state" | "isDraft" | "mergeability" | "baseBranch">,
): { tone: PullRequestMergeStatusTone; label: string } {
  if (detail.state === "merged") return { tone: "muted", label: i18n._("Merged") };
  if (detail.state === "closed") return { tone: "muted", label: i18n._("Closed") };
  if (detail.isDraft) return { tone: "muted", label: i18n._("Draft") };
  if (detail.mergeability === "conflicting") {
    return {
      tone: "conflict",
      label: i18n._("Conflicts with {branch}", { branch: detail.baseBranch }),
    };
  }
  if (detail.mergeability === "mergeable") {
    return { tone: "success", label: i18n._("Can merge without conflicts") };
  }
  return { tone: "muted", label: i18n._("Merge status unknown") };
}

const LIST_SEPARATOR = msg({ message: ", ", context: "Between the parts of a checks summary" });

/** "24 successful", "2 failing, 22 successful": the checks row's one-line summary. */
export function describePullRequestChecksBrief(
  checks: ReadonlyArray<{
    status: PullRequestDetail["checks"][number]["status"];
  }>,
): { tone: "success" | "failure" | "pending" | "none"; label: string } {
  if (checks.length === 0) return { tone: "none", label: i18n._("No checks") };
  const count = (...statuses: string[]) =>
    checks.filter((check) => statuses.includes(check.status)).length;
  const failing = count("failure", "cancelled");
  const pending = count("pending");
  const successful = count("success");
  const parts = [
    failing > 0 ? i18n._("{count} failing", { count: failing }) : null,
    pending > 0 ? i18n._("{count} pending", { count: pending }) : null,
    successful > 0 ? i18n._("{count} successful", { count: successful }) : null,
  ].filter((part) => part !== null);
  const label =
    parts.length > 0
      ? parts.join(i18n._(LIST_SEPARATOR))
      : i18n._("{count} skipped", { count: checks.length });
  return {
    tone: failing > 0 ? "failure" : pending > 0 ? "pending" : successful > 0 ? "success" : "none",
    label,
  };
}

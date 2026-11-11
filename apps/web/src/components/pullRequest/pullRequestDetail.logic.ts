import type {
  PullRequestDetail,
  PullRequestDetailInput,
  PullRequestState,
} from "@synara/contracts";

import { t } from "~/i18n";
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
  if (isDraft && state === "open") return t("git:column_draft");
  if (state === "open") return t("git:readyForReview");
  if (state === "merged") return t("git:merged");
  return t("chat:closed");
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
  const someone = t("lattice:someone");
  const opener = githubActorName(detail.author) ?? someone;
  const events: PullRequestTimelineEvent[] = [
    {
      id: "created",
      at: detail.createdAt,
      title: isIssue
        ? t("lattice:openedThisIssue", { name: opener })
        : t("lattice:openedThisPullRequest", { name: opener }),
      body: null,
    },
    ...(detail.commits ?? []).map((commit) => {
      const authorLabel = commit.authors.map(githubActorName).find((name) => name !== null);
      return {
        id: commit.oid,
        at: commit.committedDate,
        title: authorLabel
          ? t("lattice:commitBy", { sha: commit.oid.slice(0, 7), name: authorLabel })
          : t("lattice:commit2", { sha: commit.oid.slice(0, 7) }),
        body: commit.messageHeadline || t("lattice:noCommitMessage"),
      };
    }),
    ...detail.comments.map((comment) => ({
      id: comment.id,
      at: comment.createdAt,
      title:
        comment.kind === "review"
          ? t("lattice:reviewed", { name: githubActorName(comment.author) ?? someone })
          : t("lattice:commented", { name: githubActorName(comment.author) ?? someone }),
      // Timeline previews are plain text, so raw markdown/HTML would print literally.
      body: pullRequestMarkdownPreview(comment.body) || null,
    })),
    ...(mergedAt
      ? [
          {
            id: "merged",
            at: mergedAt,
            title: isIssue ? t("lattice:issueMerged") : t("lattice:pullRequestMerged"),
            body: null,
          },
        ]
      : []),
    ...(detail.closedAt && !mergedAt
      ? [
          {
            id: "closed",
            at: detail.closedAt,
            title: isIssue ? t("git:issueClosed") : t("lattice:pullRequestClosed"),
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
  if (detail.state === "merged") return { tone: "muted", label: t("git:merged") };
  if (detail.state === "closed") return { tone: "muted", label: t("chat:closed") };
  if (detail.isDraft) return { tone: "muted", label: t("git:column_draft") };
  if (detail.mergeability === "conflicting") {
    return {
      tone: "conflict",
      label: t("lattice:conflictsWith", { branch: detail.baseBranch }),
    };
  }
  if (detail.mergeability === "mergeable") {
    return { tone: "success", label: t("lattice:canMergeWithoutConflicts") };
  }
  return { tone: "muted", label: t("lattice:mergeStatusUnknown") };
}

const LIST_SEPARATOR = "lattice:checksSummarySeparator";

/** "24 successful", "2 failing, 22 successful": the checks row's one-line summary. */
export function describePullRequestChecksBrief(
  checks: ReadonlyArray<{
    status: PullRequestDetail["checks"][number]["status"];
  }>,
): { tone: "success" | "failure" | "pending" | "none"; label: string } {
  if (checks.length === 0) return { tone: "none", label: t("git:noChecks") };
  const count = (...statuses: string[]) =>
    checks.filter((check) => statuses.includes(check.status)).length;
  const failing = count("failure", "cancelled");
  const pending = count("pending");
  const successful = count("success");
  const parts = [
    failing > 0 ? t("lattice:failing", { count: failing }) : null,
    pending > 0 ? t("lattice:pending", { count: pending }) : null,
    successful > 0 ? t("lattice:successful", { count: successful }) : null,
  ].filter((part) => part !== null);
  const label =
    parts.length > 0
      ? parts.join(t(LIST_SEPARATOR))
      : t("lattice:skipped", { count: checks.length });
  return {
    tone: failing > 0 ? "failure" : pending > 0 ? "pending" : successful > 0 ? "success" : "none",
    label,
  };
}

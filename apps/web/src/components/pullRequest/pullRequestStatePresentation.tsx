import type { GitHubIssueState, GitHubIssueStateReason } from "@synara/contracts";

import {
  GitMergeConflictIcon,
  GitMergedSimpleIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  IssueClosedIcon,
  IssueNotPlannedIcon,
  IssueOpenedIcon,
  type LucideIcon,
} from "~/lib/icons";

import { t } from "~/i18n";
import { cn } from "~/lib/utils";

/** Shared PR-state presentation so every PR surface labels, colors, and glyphs PRs identically. */
export interface PrStatePresentation {
  label: "PR open" | "PR closed" | "PR merged" | "PR draft" | "PR has conflicts";
  colorClass: string;
  iconKind: "pull-request" | "draft" | "pull-request-closed" | "merged-simple" | "merge-conflict";
}

export const PR_STATE_PRESENTATION_ICONS: Record<PrStatePresentation["iconKind"], LucideIcon> = {
  "pull-request": GitPullRequestIcon,
  draft: GitPullRequestDraftIcon,
  "pull-request-closed": GitPullRequestClosedIcon,
  "merged-simple": GitMergedSimpleIcon,
  "merge-conflict": GitMergeConflictIcon,
};

/**
 * Draft and mergeability are optional because persisted `lastKnownPr` entries written
 * before those fields existed lack them; absence falls back to the plain state badge.
 * Precedence for open PRs: conflicts (actionable) over draft (informational).
 */
export function resolvePrStatePresentation(pr: {
  state: "open" | "closed" | "merged";
  isDraft?: boolean | undefined;
  mergeability?: "mergeable" | "conflicting" | "unknown" | undefined;
}): PrStatePresentation {
  if (pr.state === "open") {
    // Draft outranks conflicts: a draft isn't heading for a merge yet, so its state stays
    // "draft" (git semantics). Conflicts surface once the PR is actually mergeable work.
    if (pr.isDraft === true) {
      return {
        label: "PR draft",
        // GitHub renders drafts gray; reuse the closed treatment so draft reads as "not live yet".
        colorClass: "text-status-neutral",
        iconKind: "draft",
      };
    }
    if (pr.mergeability === "conflicting") {
      return {
        label: "PR has conflicts",
        // The same red as a failed check, so one red means "something is wrong" everywhere.
        colorClass: "text-status-failure",
        iconKind: "merge-conflict",
      };
    }
    return {
      label: "PR open",
      // Match the diff "+" green so an opened PR reads as the same positive signal.
      colorClass: "text-status-open",
      iconKind: "pull-request",
    };
  }
  if (pr.state === "closed") {
    return {
      label: "PR closed",
      colorClass: "text-status-neutral",
      iconKind: "pull-request-closed",
    };
  }
  return {
    label: "PR merged",
    colorClass: "text-status-merged",
    iconKind: "merged-simple",
  };
}

/** Shared issue-state presentation: the issue counterpart of {@link PrStatePresentation}. */
export interface IssueStatePresentation {
  label: "Issue open" | "Issue closed" | "Issue not planned";
  /** Short visible state word for badges ("Closed"); `label` is the accessible name. */
  shortLabel: "Open" | "Closed" | "Not planned";
  colorClass: string;
  iconKind: "issue-opened" | "issue-closed" | "issue-not-planned";
}

export const ISSUE_STATE_PRESENTATION_ICONS: Record<
  IssueStatePresentation["iconKind"],
  LucideIcon
> = {
  "issue-opened": IssueOpenedIcon,
  "issue-closed": IssueClosedIcon,
  "issue-not-planned": IssueNotPlannedIcon,
};

/**
 * GitHub's issue colors on the pull request tokens: open is the same green as an open pull
 * request, completed is the merged purple (the work landed), and not planned or duplicate is
 * the neutral grey of a closed pull request.
 */
export function resolveIssueStatePresentation(issue: {
  state: GitHubIssueState;
  stateReason: GitHubIssueStateReason | null;
}): IssueStatePresentation {
  if (issue.state === "open") {
    return {
      label: "Issue open",
      shortLabel: "Open",
      colorClass: "text-status-open",
      iconKind: "issue-opened",
    };
  }
  if (issue.stateReason === "not-planned" || issue.stateReason === "duplicate") {
    return {
      label: "Issue not planned",
      shortLabel: "Not planned",
      colorClass: "text-status-neutral",
      iconKind: "issue-not-planned",
    };
  }
  return {
    label: "Issue closed",
    shortLabel: "Closed",
    colorClass: "text-status-merged",
    iconKind: "issue-closed",
  };
}

const OPEN_STATE = "lattice:githubItemStateOpen";

/**
 * A state label from this module or `pullRequestStateLabel`, in the UI language. The labels
 * themselves stay English because agent prompts quote them; only what the UI shows goes
 * through here.
 */
export function localizeGitHubStateLabel(label: string): string {
  switch (label) {
    case "PR open":
      return t("git:pr_open");
    case "PR closed":
      return t("git:pr_closed");
    case "PR merged":
      return t("git:pr_merged");
    case "PR draft":
      return t("git:pRDraft");
    case "PR has conflicts":
      return t("git:pRHasConflicts");
    case "Issue open":
      return t("git:issueOpen");
    case "Issue closed":
      return t("git:issueClosed");
    case "Issue not planned":
      return t("git:issueNotPlanned");
    case "Open":
      return t(OPEN_STATE);
    case "Closed":
      return t("chat:closed");
    case "Not planned":
      return t("git:notPlanned");
    case "Draft":
      return t("git:column_draft");
    case "Has conflicts":
      return t("git:hasConflicts");
    case "Merged":
      return t("git:merged");
    default:
      return label;
  }
}

/**
 * The "this pull request has conflicts" glyph, for surfaces that call the conflict out beside
 * their own copy (a meta row, an environment row) rather than through the state glyph. It
 * resolves the icon and the red from the table above, so a surface can't reach for a generic
 * alert icon or amber and quietly disagree with the badge sitting next to it. The ink is the
 * point, so callers pass size only.
 */
export function PullRequestConflictIcon({ className }: { className?: string }) {
  const presentation = resolvePrStatePresentation({ state: "open", mergeability: "conflicting" });
  const Icon = PR_STATE_PRESENTATION_ICONS[presentation.iconKind];
  return <Icon aria-hidden className={cn("shrink-0", presentation.colorClass, className)} />;
}

export const PR_STATE_LABEL_KEYS: Record<PrStatePresentation["label"], string> = {
  "PR open": "git:pr_open",
  "PR closed": "git:pr_closed",
  "PR merged": "git:pr_merged",
  "PR draft": "git:pRDraft",
  "PR has conflicts": "git:pRHasConflicts",
};

export const ISSUE_STATE_LABEL_KEYS: Record<IssueStatePresentation["label"], string> = {
  "Issue open": "git:issueOpen",
  "Issue closed": "git:issueClosed",
  "Issue not planned": "git:issueNotPlanned",
};

export const ISSUE_STATE_SHORT_LABEL_KEYS: Record<IssueStatePresentation["shortLabel"], string> = {
  Open: "onboarding:notification_open",
  Closed: "chat:closed",
  "Not planned": "git:notPlanned",
};

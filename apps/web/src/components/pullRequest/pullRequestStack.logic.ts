import type { PullRequestDetail, PullRequestStack, PullRequestStackEntry } from "@synara/contracts";

import { t } from "~/i18n";

export type PullRequestStackAssessment = {
  readonly label:
    | "Ready to merge"
    | "Stack needs attention"
    | "Merge status pending"
    | "Mergeable with failing checks"
    | "Stack merged";
  readonly tone: "ready" | "blocked" | "pending" | "warning" | "complete";
  readonly mergeTargetCount: number;
  readonly canAttemptMerge: boolean;
  readonly blocker: string | null;
};

/** An assessment's label in the UI language. */
export function localizeStackAssessmentLabel(label: PullRequestStackAssessment["label"]): string {
  switch (label) {
    case "Ready to merge":
      return t("lattice:readyToMerge");
    case "Stack needs attention":
      return t("lattice:stackNeedsAttention");
    case "Merge status pending":
      return t("lattice:mergeStatusPending");
    case "Mergeable with failing checks":
      return t("lattice:mergeableWithFailingChecks");
    case "Stack merged":
      return t("git:stackMerged");
  }
}

/** Entries affected by merging the selected PR, ordered from the base branch upwards. */
export function pullRequestStackTargetEntries(
  stack: PullRequestStack,
): ReadonlyArray<PullRequestStackEntry> {
  return stack.entries.filter(
    (entry) => entry.position <= stack.position && entry.state !== "merged",
  );
}

export function assessPullRequestStack(stack: PullRequestStack): PullRequestStackAssessment {
  const targets = pullRequestStackTargetEntries(stack);
  if (targets.length === 0) {
    return {
      label: "Stack merged",
      tone: "complete",
      mergeTargetCount: 0,
      canAttemptMerge: false,
      blocker: null,
    };
  }

  const closed = targets.find((entry) => entry.state === "closed");
  if (closed) {
    return {
      label: "Stack needs attention",
      tone: "blocked",
      mergeTargetCount: targets.length,
      canAttemptMerge: false,
      blocker: t("lattice:isClosedWithoutBeingMerged", { number: closed.number }),
    };
  }

  const draft = targets.find((entry) => entry.isDraft);
  if (draft) {
    return {
      label: "Stack needs attention",
      tone: "blocked",
      mergeTargetCount: targets.length,
      canAttemptMerge: false,
      blocker: t("lattice:isStillADraft", { number: draft.number }),
    };
  }

  const conflicting = targets.find(
    (entry) =>
      entry.mergeability === "conflicting" ||
      ["BLOCKED", "DIRTY", "DRAFT"].includes(entry.mergeStateStatus ?? ""),
  );
  if (conflicting) {
    return {
      label: "Stack needs attention",
      tone: "blocked",
      mergeTargetCount: targets.length,
      canAttemptMerge: false,
      blocker: t("lattice:isNotReadyToMerge", { number: conflicting.number }),
    };
  }

  if (targets.some((entry) => entry.mergeStateStatus === "UNSTABLE")) {
    return {
      label: "Mergeable with failing checks",
      tone: "warning",
      mergeTargetCount: targets.length,
      canAttemptMerge: true,
      blocker: null,
    };
  }

  const pending = targets.some(
    (entry) =>
      entry.mergeability === "unknown" ||
      entry.mergeStateStatus === null ||
      ["BEHIND", "UNKNOWN"].includes(entry.mergeStateStatus),
  );
  if (pending) {
    return {
      label: "Merge status pending",
      tone: "pending",
      mergeTargetCount: targets.length,
      canAttemptMerge: true,
      blocker: null,
    };
  }

  return {
    label: "Ready to merge",
    tone: "ready",
    mergeTargetCount: targets.length,
    canAttemptMerge: true,
    blocker: null,
  };
}

export function pullRequestMergeBlocker(
  detail: Pick<PullRequestDetail, "mergeability" | "stackMetadataIncomplete">,
  stackAssessment: PullRequestStackAssessment | null,
): string | null {
  if (detail.stackMetadataIncomplete === true) {
    return t("lattice:stackDetailsAreTemporarilyUnavailableRefreshBefore");
  }
  if (stackAssessment?.canAttemptMerge === false) {
    return stackAssessment.blocker ?? t("lattice:thisStackIsNotReadyToMerge");
  }
  return detail.mergeability === "conflicting"
    ? t("lattice:resolveMergeConflictsBeforeMerging")
    : null;
}

import type { PullRequestMergeMethod, PullRequestStack } from "@synara/contracts";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import { t, useTranslation } from "~/i18n";

export type PullRequestConfirmAction =
  | { kind: "merge"; method: PullRequestMergeMethod }
  | { kind: "close" };

export function copyPullRequestLink(url: string): void {
  void copyTextToClipboard(url)
    .then(() => {
      toastManager.add({ type: "success", title: t("git:linkCopied") });
    })
    .catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: t("git:couldNotCopyLink"),
        description: error instanceof Error ? error.message : t("git:clipboardAccessFailed"),
      });
    });
}

/** A merge method as the confirmation sentence names it ("using squash"). */
const MERGE_METHOD_NAMES = {
  merge: "lattice:mergeMethodMerge",
  squash: "lattice:mergeMethodSquash",
  rebase: "lattice:mergeMethodRebase",
} as const;

function confirmTitle(
  translate: typeof t,
  action: PullRequestConfirmAction,
  stack: PullRequestStack | null,
  stackMergeTargetCount: number,
): string {
  if (action.kind === "close") return t("git:closePullRequest2");
  return stack
    ? translate("lattice:mergePullRequests", { count: stackMergeTargetCount })
    : translate("git:mergePullRequest");
}

function confirmDescription(
  translate: typeof t,
  action: PullRequestConfirmAction,
  number: number,
  baseBranch: string | null,
  stack: PullRequestStack | null,
): string {
  if (action.kind === "close")
    return translate("git:thisWillCloseWithoutMergingIt", { value0: number });
  const method = translate(MERGE_METHOD_NAMES[action.method]);
  if (stack) {
    const merge = translate("lattice:thisWillAtomicallyMergeEveryOpenPull", {
      number,
      branch: stack.baseBranch,
      method,
    });
    return stack.position < stack.size
      ? `${merge} ${translate("git:pullRequestsAboveItWillRemainOpenAndGitHub")}`
      : merge;
  }
  return baseBranch
    ? translate("lattice:thisWillMergeIntoUsing", { number, branch: baseBranch, method })
    : translate("lattice:thisWillMergeUsing", { number, method });
}

export function PullRequestConfirmActionDialog({
  action,
  number,
  baseBranch = null,
  stack,
  stackMergeTargetCount,
  pending,
  onConfirm,
  onDismiss,
}: {
  /** The action awaiting confirmation; null keeps the dialog closed. */
  action: PullRequestConfirmAction | null;
  number: number;
  baseBranch?: string | null;
  stack: PullRequestStack | null;
  stackMergeTargetCount: number;
  pending: boolean;
  onConfirm: (action: PullRequestConfirmAction) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();

  // Keep rendering the last action while the dialog animates out, so the copy does not
  // flip to another action's text once the owner resets `action` to null.
  const [shownAction, setShownAction] = useState(action);
  // Compared by value: owners may build the action object inline on every render.
  if (
    action !== null &&
    (shownAction === null ||
      action.kind !== shownAction.kind ||
      (action.kind === "merge" &&
        shownAction.kind === "merge" &&
        action.method !== shownAction.method))
  ) {
    setShownAction(action);
  }
  const shown = action ?? shownAction;

  return (
    <AlertDialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <AlertDialogPopup>
        {shown ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmTitle(t, shown, stack, stackMergeTargetCount)}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmDescription(t, shown, number, baseBranch, stack)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" size="sm" />}>
                {t("common:form_cancel")}
              </AlertDialogClose>
              <Button
                size="sm"
                variant={shown.kind === "close" ? "destructive" : "default"}
                disabled={pending}
                onClick={() => {
                  onDismiss();
                  onConfirm(shown);
                }}
              >
                {shown.kind === "close"
                  ? t("common:app_close")
                  : stack
                    ? t("git:mergeStack")
                    : t("git:merge")}
              </Button>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogPopup>
    </AlertDialog>
  );
}

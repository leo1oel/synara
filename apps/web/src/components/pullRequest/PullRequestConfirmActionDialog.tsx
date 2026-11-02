// FILE: PullRequestConfirmActionDialog.tsx
// Purpose: The one confirmation dialog for the irreversible pull request actions (merge,
//          close), shared by the PR detail panel and the Environment panel's PR menu, plus the
//          "copy PR link" helper both surfaces expose next to those actions.
// Layer: Pull request UI
// Depends on: the shared alert dialog, toast manager, and clipboard helper.

import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
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
  merge: msg({ message: "merge", context: "merge method" }),
  squash: msg({ message: "squash", context: "merge method" }),
  rebase: msg({ message: "rebase", context: "merge method" }),
} as const;

function confirmTitle(
  i18n: I18n,
  action: PullRequestConfirmAction,
  stack: PullRequestStack | null,
  stackMergeTargetCount: number,
): string {
  if (action.kind === "close") return t("git:closePullRequest2");
  return stack
    ? i18n._("{count, plural, one {Merge # pull request?} other {Merge # pull requests?}}", {
        count: stackMergeTargetCount,
      })
    : i18n._("Merge pull request?");
}

function confirmDescription(
  i18n: I18n,
  action: PullRequestConfirmAction,
  number: number,
  baseBranch: string | null,
  stack: PullRequestStack | null,
): string {
  if (action.kind === "close")
    return i18n._("This will close #{number} without merging it.", { number });
  const method = i18n._(MERGE_METHOD_NAMES[action.method]);
  if (stack) {
    const merge = i18n._(
      "This will atomically merge every open pull request through #{number} into {branch} using {method}.",
      { number, branch: stack.baseBranch, method },
    );
    return stack.position < stack.size
      ? `${merge} ${i18n._("Pull requests above it will remain open and GitHub will retarget them.")}`
      : merge;
  }
  return baseBranch
    ? i18n._("This will merge #{number} into {branch} using {method}.", {
        number,
        branch: baseBranch,
        method,
      })
    : i18n._("This will merge #{number} using {method}.", { number, method });
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
                {confirmTitle(i18n, shown, stack, stackMergeTargetCount)}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmDescription(i18n, shown, number, baseBranch, stack)}
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

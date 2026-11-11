// Shared confirm-gated Codex resets in settings and usage popovers.
//
// A reset is only worth spending once the ordinary 5-hour or weekly window is nearly used up,
// and the server refuses earlier redemptions. The buttons still stay clickable then: a disabled
// row read as broken ("clicking does nothing"), so a click explains why no reset is possible
// yet instead. A real redemption always goes through an in-panel confirmation whose default
// focus is Cancel, so neither a stray click nor Enter can spend a reset.
import type {
  CodexResetCreditOutcome,
  ServerCodexResetCredit,
  ServerCodexResetCredits,
  ServerConsumeCodexResetCreditInput,
} from "@synara/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

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
import {
  finishCodexResetAttempt,
  prepareCodexResetAttempt,
  readCodexResetAttempt,
} from "~/lib/codexResetAttempt";
import { t, useTranslation } from "~/i18n";
import { consumeCodexResetCredit, serverQueryKeys } from "~/lib/serverReactQuery";

function formatExpiry(translate: typeof t, expiresAt: string | undefined, now: number): string {
  if (!expiresAt) return translate("lattice:noExpiryDate");
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return translate("common:expired");
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return translate("lattice:expiresInM", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 48) {
    return translate("lattice:expiresInHM", { hours, minutes: mins % 60 });
  }
  return translate("lattice:expiresInDH", { days: Math.floor(hours / 24), hours: hours % 24 });
}

function outcomeMessage(translate: typeof t, outcome: CodexResetCreditOutcome): string {
  switch (outcome) {
    case "reset":
      return translate("lattice:codexUsageLimitsWereReset");
    case "nothingToReset":
      return translate("lattice:codexUsageLimitsDonTNeedA");
    case "noCredit":
      return translate("lattice:noSavedResetsLeft");
    case "alreadyRedeemed":
      return translate("lattice:thatResetWasAlreadyUsed");
  }
}

// Fixed reset errors from the server and the attempt store; anything else passes through.
function localizeResetError(message: string): string {
  switch (message) {
    case "Codex rejected the reset-credit request.":
      return t("lattice:codexRejectedTheResetRequest");
    case "Codex reset-credit request timed out. Retry the same attempt.":
      return t("lattice:codexDidnTAnswerInTimeRetry");
    case "Codex app-server exited during the reset-credit request.":
      return t("lattice:codexStoppedDuringTheResetRequestRetry");
    case "The Codex account changed. Refresh usage before using a reset.":
      return t("lattice:theCodexAccountChangedRefreshUsageBefore");
    case "Current Codex usage is unavailable. Retry the same attempt when it returns.":
      return t("lattice:currentCodexUsageCanTBeRead");
    case "Codex returned an unknown reset result. Retry the same attempt.":
      return t("lattice:codexReturnedAnUnexpectedResultRetryTo");
    case "A reset is already in progress for this Codex account.":
      return t("lattice:aResetIsAlreadyInProgressFor");
    case "Retry the previous reset before choosing another one.":
      return t("lattice:retryThePreviousResetBeforeChoosingAnother");
    case "The previous Codex reset attempt could not be read. No new reset was requested.":
      return t("lattice:thePreviousResetAttemptCouldnTBe");
    default:
      return message;
  }
}

type ResetDialog =
  | { kind: "confirm"; creditId: string | undefined; isRetry: boolean }
  | { kind: "notYet" }
  | { kind: "usageUnknown" };

export function ProviderUsageResetCredits({
  resetCredits,
  surface = "settings",
}: {
  resetCredits: ServerCodexResetCredits;
  surface?: "settings" | "popover";
}) {
  const { t } = useTranslation();

  const { accountId, availableCount, canUse, credits } = resetCredits;
  const queryClient = useQueryClient();
  const locked = useRef(false);
  const initialFocusRef = useRef<HTMLButtonElement | null>(null);
  const [dialog, setDialog] = useState<ResetDialog | null>(null);
  // Keeps the last dialog's copy on screen while it animates out after `dialog` resets to null.
  const [shownDialog, setShownDialog] = useState<ResetDialog | null>(null);
  if (dialog !== null && dialog !== shownDialog) setShownDialog(dialog);
  const shown = dialog ?? shownDialog;
  const [applying, setApplying] = useState(false);
  let pendingAttempt: ServerConsumeCodexResetCreditInput | null = null;
  let storageUnavailable = false;
  try {
    pendingAttempt = accountId ? readCodexResetAttempt(accountId) : null;
  } catch {
    storageUnavailable = true;
  }
  const consumeMutation = useMutation({
    mutationFn: consumeCodexResetCredit,
    onSuccess: (result, attempt) => {
      // Every recognized outcome completes the attempt, even if the subsequent usage read fails.
      try {
        finishCodexResetAttempt(attempt);
      } catch {
        /* Retaining the same key remains safe. */
      }
      toastManager.add({
        type:
          result.outcome === "reset" || result.outcome === "alreadyRedeemed" ? "success" : "info",
        title: outcomeMessage(t, result.outcome),
      });
    },
  });
  const consume = async (creditId: string | undefined) => {
    if (!accountId || locked.current) return;
    locked.current = true;
    setApplying(true);
    try {
      await consumeMutation.mutateAsync(prepareCodexResetAttempt(accountId, creditId));
    } catch (error) {
      toastManager.add({
        type: "error",
        title: t("lattice:couldnTConfirmWhetherTheResetWas"),
        description:
          error instanceof Error
            ? localizeResetError(error.message)
            : t("lattice:chooseRetryResetToCheckTheSame"),
      });
    } finally {
      void queryClient.invalidateQueries({ queryKey: serverQueryKeys.allProviderUsage() });
      locked.current = false;
      setApplying(false);
    }
  };
  const requestReset = (creditId: string | undefined, isRetry: boolean) => {
    if (!accountId || locked.current) return;
    // A retry re-checks an attempt that may already have spent its reset, so it is always allowed.
    if (!isRetry && canUse === false) setDialog({ kind: "notYet" });
    else if (!isRetry && canUse !== true) setDialog({ kind: "usageUnknown" });
    else setDialog({ kind: "confirm", creditId, isRetry });
  };
  if (availableCount <= 0 && !pendingAttempt) return null;
  const now = Date.now();
  const availableCredits = (credits ?? []).filter(
    (credit) =>
      credit.status === "available" && (!credit.expiresAt || Date.parse(credit.expiresAt) > now),
  );
  const rows: Array<ServerCodexResetCredit | undefined> = [...availableCredits];
  if (pendingAttempt && !rows.some((credit) => credit?.id === pendingAttempt.creditId)) {
    rows.unshift(pendingAttempt.creditId ? { id: pendingAttempt.creditId } : undefined);
  } else if (credits === undefined && availableCount > 0) rows.push(undefined);
  const busy = consumeMutation.isPending || applying;
  const compact = surface === "popover";
  const rowClass = `flex items-center justify-between gap-2 ${compact ? "text-chat-meta leading-tight" : "text-ui leading-snug"}`;
  const subtitleClass = compact
    ? "text-chat-meta leading-tight text-muted-foreground/80"
    : "text-ui-sm text-muted-foreground/80";
  return (
    <div
      className={`space-y-0.5 border-t border-[color:var(--color-border)] ${compact ? "pt-2" : "pt-3"}`}
    >
      <div className={rowClass}>
        <span className="font-medium text-foreground">{t("lattice:savedResets")}</span>
        <span className="text-right tabular-nums text-muted-foreground">
          {t("common:left2", { duration: availableCount })}
        </span>
      </div>
      <p className={subtitleClass}>
        {pendingAttempt
          ? t("lattice:aPreviousResetWasnTConfirmedRetry")
          : canUse === true
            ? t("lattice:your5HourOrWeeklyLimitIs")
            : t("lattice:canBeUsedOnceYour5Hour")}
      </p>
      {rows.length > 0 ? (
        <div className="mt-1.5 space-y-1.5">
          {rows.map((credit, index) => {
            const isRetry = pendingAttempt !== null && pendingAttempt.creditId === credit?.id;
            return (
              <div key={credit?.id ?? "next-available"}>
                <div className={rowClass}>
                  <span className="font-medium text-foreground">
                    {credit
                      ? t("common:reset", { value0: index + 1 })
                      : t("common:nextAvailableReset")}
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    className="shrink-0"
                    disabled={
                      busy ||
                      storageUnavailable ||
                      !accountId ||
                      (!isRetry && pendingAttempt !== null)
                    }
                    onClick={() => requestReset(credit?.id, isRetry)}
                  >
                    {busy
                      ? t("common:applying")
                      : isRetry
                        ? t("common:retryReset")
                        : t("common:useReset")}
                  </Button>
                </div>
                {credit ? (
                  <div className={`${subtitleClass} tabular-nums`} title={credit.expiresAt}>
                    {formatExpiry(t, credit.expiresAt, now)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <AlertDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <AlertDialogPopup
          className="max-w-sm"
          bottomStickOnMobile={false}
          initialFocus={initialFocusRef}
        >
          {shown?.kind === "confirm" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {shown.isRetry ? t("lattice:checkThePreviousReset") : t("lattice:use1ResetNow")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {shown.isRetry
                    ? t("lattice:thisAsksCodexAgainWhetherYourPrevious")
                    : t("lattice:thisUses1OfYourSavedResets", { count: availableCount })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                {/* Cancel takes the initial focus: Enter or Space on an opened dialog never spends a reset. */}
                <AlertDialogClose
                  ref={initialFocusRef}
                  render={<Button variant="outline" size="sm" />}
                >
                  {t("common:form_cancel")}
                </AlertDialogClose>
                <Button
                  size="sm"
                  onClick={() => {
                    setDialog(null);
                    void consume(shown.creditId);
                  }}
                >
                  {shown.isRetry ? t("common:retryReset") : t("common:useReset")}
                </Button>
              </AlertDialogFooter>
            </>
          ) : shown ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {shown.kind === "notYet"
                    ? t("lattice:youCanTUseAResetYet")
                    : t("lattice:currentUsageIsnTAvailable")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {shown.kind === "notYet"
                    ? t("lattice:aResetCanOnlyBeUsedOnce")
                    : t("lattice:yourCurrentCodexUsageCouldnTBe")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose ref={initialFocusRef} render={<Button size="sm" />}>
                  {t("common:whatsNew_gotIt")}
                </AlertDialogClose>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

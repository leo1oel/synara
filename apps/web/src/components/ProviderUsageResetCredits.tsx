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
import type { I18n } from "@lingui/core";
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
import { i18n } from "~/i18n";
import { consumeCodexResetCredit, serverQueryKeys } from "~/lib/serverReactQuery";

function formatExpiry(i18n: I18n, expiresAt: string | undefined, now: number): string {
  if (!expiresAt) return i18n._("No expiry date");
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return i18n._("Expired");
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return i18n._("Expires in {count}m", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 48) {
    return i18n._("Expires in {hours}h {minutes}m", { hours, minutes: mins % 60 });
  }
  return i18n._("Expires in {days}d {hours}h", { days: Math.floor(hours / 24), hours: hours % 24 });
}

function outcomeMessage(i18n: I18n, outcome: CodexResetCreditOutcome): string {
  switch (outcome) {
    case "reset":
      return i18n._("Codex usage limits were reset.");
    case "nothingToReset":
      return i18n._("Codex usage limits don't need a reset right now. No reset was used.");
    case "noCredit":
      return i18n._("No saved resets left.");
    case "alreadyRedeemed":
      return i18n._("That reset was already used.");
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
        title: outcomeMessage(i18n, result.outcome),
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
        title: i18n._("Couldn't confirm whether the reset was used"),
        description:
          error instanceof Error
            ? error.message
            : i18n._("Choose Retry reset to check the same attempt again."),
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
        <span className="font-medium text-foreground">{i18n._("Saved resets")}</span>
        <span className="text-right tabular-nums text-muted-foreground">
          {i18n._("{count} left", { count: availableCount })}
        </span>
      </div>
      <p className={subtitleClass}>
        {pendingAttempt
          ? i18n._("A previous reset wasn't confirmed. Retry checks the same attempt.")
          : canUse === true
            ? i18n._("Your 5-hour or weekly limit is nearly used up, so a reset can be used now.")
            : i18n._("Can be used once your 5-hour or weekly limit has 10% or less left.")}
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
                      ? i18n._("Reset {number}", { number: index + 1 })
                      : i18n._("Next available reset")}
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
                      ? i18n._("Applying…")
                      : isRetry
                        ? i18n._("Retry reset")
                        : i18n._("Use reset")}
                  </Button>
                </div>
                {credit ? (
                  <div className={`${subtitleClass} tabular-nums`} title={credit.expiresAt}>
                    {formatExpiry(i18n, credit.expiresAt, now)}
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
                  {shown.isRetry ? i18n._("Check the previous reset?") : i18n._("Use 1 reset now?")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {shown.isRetry
                    ? i18n._(
                        "This asks Codex again whether your previous reset went through. If it didn't, that same reset is used now. A used reset can't be undone or given back.",
                      )
                    : i18n._(
                        "This uses 1 of your {count} saved resets to restore your Codex usage limits right away. A used reset can't be undone or given back.",
                        { count: availableCount },
                      )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                {/* Cancel takes the initial focus: Enter or Space on an opened dialog never spends a reset. */}
                <AlertDialogClose
                  ref={initialFocusRef}
                  render={<Button variant="outline" size="sm" />}
                >
                  {i18n._("Cancel")}
                </AlertDialogClose>
                <Button
                  size="sm"
                  onClick={() => {
                    setDialog(null);
                    void consume(shown.creditId);
                  }}
                >
                  {shown.isRetry ? i18n._("Retry reset") : i18n._("Use reset")}
                </Button>
              </AlertDialogFooter>
            </>
          ) : shown ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {shown.kind === "notYet"
                    ? i18n._("You can't use a reset yet")
                    : i18n._("Current usage isn't available")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {shown.kind === "notYet"
                    ? i18n._(
                        "A reset can only be used once your 5-hour or weekly limit has 10% or less left. You still have more than that, so nothing was used.",
                      )
                    : i18n._(
                        "Your current Codex usage couldn't be read, so there's no way to tell whether a reset would help. Nothing was used. Try again in a moment.",
                      )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose ref={initialFocusRef} render={<Button size="sm" />}>
                  {i18n._("Got it")}
                </AlertDialogClose>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

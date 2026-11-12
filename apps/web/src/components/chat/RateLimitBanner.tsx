// FILE: RateLimitBanner.tsx
// Purpose: Renders provider rate limits near the active chat composer.
// Layer: Chat status presentation
// Exports: RateLimitBanner.

import type { RateLimitStatus } from "~/lib/rateLimitStatus";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { IconButton } from "../ui/icon-button";
import { CircleAlertIcon, XIcon } from "~/lib/icons";
import { type t, useTranslation } from "~/i18n";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type RateLimitResetDuration = { unit: "minutes" | "hours" | "days"; count: number };

/** Rounds the time left to the unit a person would say: whole minutes under an hour
 *  (never "0"), about N hours under two days, about N days beyond. Claude's weekly
 *  windows put the reset days away, where raw minutes ("2822m") read as noise. */
export function describeRateLimitReset(msLeft: number): RateLimitResetDuration {
  const ms = Math.max(0, msLeft);
  if (ms < HOUR_MS) return { unit: "minutes", count: Math.max(1, Math.ceil(ms / MINUTE_MS)) };
  if (ms < 2 * DAY_MS) return { unit: "hours", count: Math.round(ms / HOUR_MS) };
  return { unit: "days", count: Math.round(ms / DAY_MS) };
}

function formatResetSentence(
  translate: typeof t,
  resetsAt: string | undefined,
  nowMs: number,
): string | null {
  if (!resetsAt) return null;
  const resetMs = Date.parse(resetsAt);
  if (Number.isNaN(resetMs)) return null;
  const { unit, count } = describeRateLimitReset(resetMs - nowMs);
  switch (unit) {
    case "minutes":
      return translate("lattice:rateLimitResetsInMinutes", { count });
    case "hours":
      return translate("lattice:rateLimitResetsInAboutHours", { count });
    case "days":
      return translate("lattice:rateLimitResetsInAboutDays", { count });
  }
}

/** The whole notice in the interface language. The status and reset sentences are
 *  joined by a catalog entry so each locale owns its spacing (none between Chinese
 *  sentences, a space in English). */
export function formatRateLimitNotice(
  translate: typeof t,
  { status, resetsAt, utilization }: RateLimitStatus,
  nowMs: number,
): string {
  const statusSentence =
    status === "rejected"
      ? translate("lattice:rateLimitReached")
      : utilization !== undefined
        ? translate("lattice:rateLimitApproachingUsed", {
            percent: Math.round(utilization * 100),
          })
        : translate("lattice:rateLimitApproaching");
  const resetSentence = formatResetSentence(translate, resetsAt, nowMs);
  return resetSentence
    ? translate("lattice:rateLimitNoticeWithReset", {
        status: statusSentence,
        reset: resetSentence,
      })
    : statusSentence;
}

export const RateLimitBanner = function RateLimitBanner({
  onDismiss,
  rateLimitStatus,
}: {
  onDismiss?: () => void;
  rateLimitStatus: RateLimitStatus | null;
}) {
  const { t } = useTranslation();

  if (!rateLimitStatus) return null;

  const isRejected = rateLimitStatus.status === "rejected";
  const message = formatRateLimitNotice(t, rateLimitStatus, Date.now());

  return (
    <Alert variant={isRejected ? "error" : "warning"}>
      <CircleAlertIcon />
      <AlertDescription>{message}</AlertDescription>
      {onDismiss ? (
        // The shared AlertAction drops below the text under the 640px breakpoint and
        // centers on the whole text otherwise. The embedded panel's viewport is the
        // panel itself, so in a narrow panel the X sat alone on a row of its own.
        // Keep it in the third column at every width, on a box one line tall, so it
        // stays beside the first line however far the message wraps.
        <AlertAction className="row-start-1 h-lh items-center self-start max-sm:col-start-3 max-sm:mt-0 sm:self-start">
          <IconButton
            className="size-6 sm:size-6"
            label={t("chat:rateLimit_dismissStatus")}
            title={t("chat:rateLimit_dismissStatus")}
            onClick={onDismiss}
          >
            <XIcon className="size-3.5" />
          </IconButton>
        </AlertAction>
      ) : null}
    </Alert>
  );
};

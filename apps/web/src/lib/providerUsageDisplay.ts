// FILE: providerUsageDisplay.ts
// Purpose: Single source of truth for provider usage rows shown in Settings,
// the chat header usage chip, and compact environment/Local popovers.

import { localizeProviderStatusMessage } from "./providerStatusMessages";
import { PROVIDER_DESCRIPTORS } from "@synara/shared/providerMetadata";
import { t } from "~/i18n";
import {
  deriveVisibleRateLimitRows,
  formatRateLimitRemainingPercent,
  formatRateLimitResetCountdown,
  rateLimitWindowDisplayLabel,
  type ProviderRateLimit,
  type VisibleRateLimitRow,
} from "~/lib/rateLimits";
import { deriveUsagePace, type UsagePaceSummary } from "~/lib/usagePace";

export type ProviderUsageTone = "healthy" | "warning" | "danger";

export interface ProviderUsageDisplayRow extends VisibleRateLimitRow {
  remainingLabel: string;
  leftText: string;
  resetText: string | null;
  pace: UsagePaceSummary | null;
  markerPercent: number | null;
  remainingTone: ProviderUsageTone;
  paceTone: ProviderUsageTone;
}

export interface ProviderUsageProgressTrackProps {
  label: string;
  remainingPercent: number;
  markerPercent: number | null;
  fillClassName: string;
  markerClassName: string;
}

export interface ProviderUsagePaceDetails {
  amountText: string | null;
  etaText: string | null;
}

export interface LocalizedProviderUsageDisplayText {
  label: string;
  leftText: string;
  resetText: string | null;
  progressLabel: string;
  paceTitle: string | undefined;
  paceDetails: ProviderUsagePaceDetails | null;
}

export const PROVIDER_USAGE_TONE_CLASS_NAME: Record<ProviderUsageTone, string> = {
  healthy: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function remainingTone(remainingPercent: number): ProviderUsageTone {
  if (remainingPercent <= 10) return "danger";
  if (remainingPercent <= 25) return "warning";
  return "healthy";
}

function paceTone(status: UsagePaceSummary["status"]): ProviderUsageTone {
  switch (status) {
    case "behind":
      return "danger";
    case "on-track":
      return "warning";
    case "ahead":
      return "healthy";
  }
}

function windowDurationMinsForRow(row: VisibleRateLimitRow): number | undefined {
  if (row.windowDurationMins !== undefined) {
    return row.windowDurationMins;
  }
  if (row.label === "5h") {
    return 300;
  }
  if (row.label === "Weekly") {
    return 10_080;
  }
  if (row.label === "Daily") {
    return 1_440;
  }
  return undefined;
}

export function providerUsageToneClassName(tone: ProviderUsageTone): string {
  return PROVIDER_USAGE_TONE_CLASS_NAME[tone];
}

export function providerUsageProgressTrackProps(
  row: ProviderUsageDisplayRow,
): ProviderUsageProgressTrackProps {
  return {
    label: t("settings:usageRemaining", { window: rateLimitWindowDisplayLabel(row.label) }),
    remainingPercent: row.remainingPercent,
    markerPercent: row.markerPercent,
    fillClassName: providerUsageToneClassName(row.remainingTone),
    markerClassName: providerUsageToneClassName(row.paceTone),
  };
}

export function providerUsagePaceDetails(
  row: ProviderUsageDisplayRow,
): ProviderUsagePaceDetails | null {
  if (!row.pace?.amountText && !row.pace?.etaText) {
    return null;
  }
  return {
    amountText: row.pace.amountText,
    etaText: row.pace.etaText,
  };
}

function localizeProviderUsageWindowLabel(translate: typeof t, label: string): string {
  switch (label) {
    case "5h":
      return translate("common:5h");
    case "Weekly":
      return translate("common:schedule_weekly");
    case "Weekly (overage)":
      return translate("lattice:weeklyOverage");
    case "Current":
      return translate("common:list_currentSection");
    default:
      // Model names such as Sonnet and Opus, plus provider-defined future labels,
      // should remain intact instead of being guessed at in the presentation layer.
      return label;
  }
}

function localizeCompactDuration(translate: typeof t, duration: string): string {
  if (duration === "<1m") {
    return translate("settings:usageDurationUnderMinute");
  }
  return duration
    .split(" ")
    .map((part) => {
      const match = /^(\d+)([dhm])$/u.exec(part);
      if (!match) return part;
      const count = match[1]!;
      switch (match[2]) {
        case "d":
          return translate("automation:intentDays", { count });
        case "h":
          return translate("automation:intentHours", { count });
        case "m":
          return translate("automation:intentMinutes", { count });
        default:
          return part;
      }
    })
    .join(" ");
}

function localizeResetText(translate: typeof t, resetText: string | null): string | null {
  if (!resetText) return null;
  if (resetText === "Resets soon") {
    return translate("settings:usageResetsSoon");
  }
  const match = /^Resets in (.+)$/u.exec(resetText);
  if (!match) return resetText;
  return translate("lattice:resetsIn", { duration: localizeCompactDuration(translate, match[1]!) });
}

function localizePaceDetails(
  translate: typeof t,
  details: ProviderUsagePaceDetails | null,
): ProviderUsagePaceDetails | null {
  if (!details) return null;

  let amountText = details.amountText;
  const amountMatch = amountText ? /^(\d+)% in (reserve|deficit)$/u.exec(amountText) : null;
  if (amountMatch?.[2] === "reserve") {
    amountText = translate("settings:usageReserve", { percent: amountMatch[1]! });
  } else if (amountMatch?.[2] === "deficit") {
    amountText = translate("settings:usageDeficit", { percent: amountMatch[1]! });
  }

  let etaText = details.etaText;
  if (etaText === "Lasts until reset") {
    etaText = translate("settings:usageLastsUntilReset");
  } else if (etaText === "Limit reached") {
    etaText = translate("settings:usageLimitReached");
  } else if (etaText) {
    const runOutMatch = /^Runs out in (.+)$/u.exec(etaText);
    if (runOutMatch) {
      etaText = translate("settings:usageRunsOut", {
        duration: localizeCompactDuration(translate, runOutMatch[1]!),
      });
    }
  }

  return { amountText, etaText };
}

/** Translate the provider-owned usage vocabulary only at the final web display boundary. */
export function localizeProviderUsageDisplayText(
  translate: typeof t,
  row: ProviderUsageDisplayRow,
): LocalizedProviderUsageDisplayText {
  const label = localizeProviderUsageWindowLabel(translate, row.label);
  const paceStatus = row.pace
    ? row.pace.status === "ahead"
      ? translate("lattice:ahead")
      : row.pace.status === "on-track"
        ? translate("lattice:onTrack")
        : translate("lattice:behind")
    : null;
  return {
    label,
    leftText: translate("common:left2", { duration: row.remainingLabel }),
    resetText: localizeResetText(translate, row.resetText),
    progressLabel: translate("settings:usageRemaining", { window: label }),
    paceTitle: paceStatus ? translate("common:usagePace", { value0: paceStatus }) : undefined,
    paceDetails: localizePaceDetails(translate, providerUsagePaceDetails(row)),
  };
}

export function localizeProviderUsageNotice(translate: typeof t, notice: string): string {
  const anthropicThrottleMatch =
    /^Anthropic is rate-limiting usage checks — showing your last values, retrying in ~(\d+)m\. Manual refreshes only extend the limit\.$/u.exec(
      notice,
    );
  if (!anthropicThrottleMatch) return localizeProviderStatusMessage(translate, notice);
  return translate("lattice:anthropicIsRateLimitingUsageChecksShowing", {
    minutes: anthropicThrottleMatch[1]!,
  });
}

export function deriveProviderUsageDisplayRow(
  row: VisibleRateLimitRow,
  translate: typeof t = t,
): ProviderUsageDisplayRow {
  const remainingPercent = clampPercent(row.remainingPercent);
  const pace = deriveUsagePace(
    {
      remainingPercent,
      resetsAt: row.resetsAt,
      windowDurationMins: windowDurationMinsForRow(row),
    },
    translate,
  );
  const remainingLabel = formatRateLimitRemainingPercent(remainingPercent);
  const usageRemainingTone = remainingTone(remainingPercent);
  const usagePaceTone = pace ? paceTone(pace.status) : usageRemainingTone;

  return {
    ...row,
    remainingPercent,
    remainingLabel,
    leftText: translate("settings:usageLeft", { amount: remainingLabel }),
    resetText: row.resetsAt ? formatRateLimitResetCountdown(row.resetsAt, translate) : null,
    pace,
    markerPercent: pace ? clampPercent(pace.expectedRemainingPercent) : null,
    remainingTone: usageRemainingTone,
    paceTone: usagePaceTone,
  };
}

export function deriveProviderUsageDisplayRows(
  rateLimits: ReadonlyArray<ProviderRateLimit>,
  translate: typeof t = t,
): ProviderUsageDisplayRow[] {
  return deriveVisibleRateLimitRows(rateLimits).map((row) =>
    deriveProviderUsageDisplayRow(row, translate),
  );
}

export function selectPrimaryProviderUsageDisplayRow(
  rows: ReadonlyArray<ProviderUsageDisplayRow>,
): ProviderUsageDisplayRow | null {
  return rows.reduce<ProviderUsageDisplayRow | null>((selected, row) => {
    if (!selected || row.remainingPercent < selected.remainingPercent) {
      return row;
    }
    return selected;
  }, null);
}

/** App-owned sign-in guidance; CLI commands come verbatim from provider metadata. */
export function localizedProviderUsageNeedsAuthDetail(
  provider: string | null | undefined,
  translate: typeof t = t,
): string {
  const command = PROVIDER_DESCRIPTORS.find((descriptor) => descriptor.kind === provider)?.usage
    ?.signInCommand;
  return command
    ? translate("settings:usageSignInCommand", { command })
    : translate("settings:usageSignInProviderCli");
}

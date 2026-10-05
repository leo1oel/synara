// FILE: providerUsageDisplay.ts
// Purpose: Single source of truth for provider usage rows shown in Settings,
// the chat header usage chip, and compact environment/Local popovers.

import type { I18n } from "@lingui/core";
import {
  deriveVisibleRateLimitRows,
  formatRateLimitRemainingPercent,
  formatRateLimitResetCountdown,
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
    label: `${row.label} remaining`,
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

function localizeProviderUsageWindowLabel(i18n: I18n, label: string): string {
  switch (label) {
    case "5h":
      return i18n._("5h");
    case "Weekly":
      return i18n._("Weekly");
    case "Weekly (overage)":
      return i18n._("Weekly (overage)");
    case "Current":
      return i18n._("Current");
    default:
      // Model names such as Sonnet and Opus, plus provider-defined future labels,
      // should remain intact instead of being guessed at in the presentation layer.
      return label;
  }
}

function localizeCompactDuration(i18n: I18n, duration: string): string {
  if (duration === "<1m") {
    return i18n._("<1m");
  }
  return duration
    .split(" ")
    .map((part) => {
      const match = /^(\d+)([dhm])$/u.exec(part);
      if (!match) return part;
      const count = match[1]!;
      switch (match[2]) {
        case "d":
          return i18n._("{count}d", { count });
        case "h":
          return i18n._("{count}h", { count });
        case "m":
          return i18n._("{count}m", { count });
        default:
          return part;
      }
    })
    .join(" ");
}

function localizeResetText(i18n: I18n, resetText: string | null): string | null {
  if (!resetText) return null;
  if (resetText === "Resets soon") {
    return i18n._("Resets soon");
  }
  const match = /^Resets in (.+)$/u.exec(resetText);
  if (!match) return resetText;
  return i18n._("Resets in {duration}", {
    duration: localizeCompactDuration(i18n, match[1]!),
  });
}

function localizePaceDetails(
  i18n: I18n,
  details: ProviderUsagePaceDetails | null,
): ProviderUsagePaceDetails | null {
  if (!details) return null;

  let amountText = details.amountText;
  const amountMatch = amountText ? /^(\d+)% in (reserve|deficit)$/u.exec(amountText) : null;
  if (amountMatch?.[2] === "reserve") {
    amountText = i18n._("{percent}% in reserve", { percent: amountMatch[1]! });
  } else if (amountMatch?.[2] === "deficit") {
    amountText = i18n._("{percent}% in deficit", { percent: amountMatch[1]! });
  }

  let etaText = details.etaText;
  if (etaText === "Lasts until reset") {
    etaText = i18n._("Lasts until reset");
  } else if (etaText === "Limit reached") {
    etaText = i18n._("Limit reached");
  } else if (etaText) {
    const runOutMatch = /^Runs out in (.+)$/u.exec(etaText);
    if (runOutMatch) {
      etaText = i18n._("Runs out in {duration}", {
        duration: localizeCompactDuration(i18n, runOutMatch[1]!),
      });
    }
  }

  return { amountText, etaText };
}

/** Translate the provider-owned usage vocabulary only at the final web display boundary. */
export function localizeProviderUsageDisplayText(
  i18n: I18n,
  row: ProviderUsageDisplayRow,
): LocalizedProviderUsageDisplayText {
  const label = localizeProviderUsageWindowLabel(i18n, row.label);
  const paceStatus = row.pace
    ? row.pace.status === "ahead"
      ? i18n._("ahead")
      : row.pace.status === "on-track"
        ? i18n._("on track")
        : i18n._("behind")
    : null;
  return {
    label,
    leftText: i18n._("{remaining} left", { remaining: row.remainingLabel }),
    resetText: localizeResetText(i18n, row.resetText),
    progressLabel: i18n._("{window} remaining", { window: label }),
    paceTitle: paceStatus ? i18n._("Usage pace: {status}", { status: paceStatus }) : undefined,
    paceDetails: localizePaceDetails(i18n, providerUsagePaceDetails(row)),
  };
}

export function localizeProviderUsageNotice(i18n: I18n, notice: string): string {
  const anthropicThrottleMatch =
    /^Anthropic is rate-limiting usage checks — showing your last values, retrying in ~(\d+)m\. Manual refreshes only extend the limit\.$/u.exec(
      notice,
    );
  if (!anthropicThrottleMatch) return notice;
  return i18n._(
    "Anthropic is rate-limiting usage checks — showing your last values, retrying in ~{minutes}m. Manual refreshes only extend the limit.",
    { minutes: anthropicThrottleMatch[1]! },
  );
}

export function deriveProviderUsageDisplayRow(row: VisibleRateLimitRow): ProviderUsageDisplayRow {
  const remainingPercent = clampPercent(row.remainingPercent);
  const pace = deriveUsagePace({
    remainingPercent,
    resetsAt: row.resetsAt,
    windowDurationMins: windowDurationMinsForRow(row),
  });
  const remainingLabel = formatRateLimitRemainingPercent(remainingPercent);
  const usageRemainingTone = remainingTone(remainingPercent);
  const usagePaceTone = pace ? paceTone(pace.status) : usageRemainingTone;

  return {
    ...row,
    remainingPercent,
    remainingLabel,
    leftText: `${remainingLabel} left`,
    resetText: row.resetsAt ? formatRateLimitResetCountdown(row.resetsAt) : null,
    pace,
    markerPercent: pace ? clampPercent(pace.expectedRemainingPercent) : null,
    remainingTone: usageRemainingTone,
    paceTone: usagePaceTone,
  };
}

export function deriveProviderUsageDisplayRows(
  rateLimits: ReadonlyArray<ProviderRateLimit>,
): ProviderUsageDisplayRow[] {
  return deriveVisibleRateLimitRows(rateLimits).map(deriveProviderUsageDisplayRow);
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

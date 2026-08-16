// FILE: ProviderUsageLineList.tsx
// Purpose: Shared provider-usage line renderer for settings cards and compact popovers.
// Keeps label/value/subtitle semantics consistent while allowing each surface its own density.

import type { I18n } from "@lingui/core";
import { useLingui } from "@lingui/react";
import type { OpenUsageUsageLine } from "~/lib/openUsageRateLimits";
import { cn } from "~/lib/utils";

type ProviderUsageLineListSurface = "settings" | "popover";

const SURFACE_CLASSES: Record<
  ProviderUsageLineListSurface,
  {
    item: string;
    row: string;
    label: string;
    value: string;
    subtitle: string;
  }
> = {
  settings: {
    item: "space-y-0.5",
    row: "flex items-center justify-between gap-2 text-xs",
    label: "font-medium text-foreground",
    value: "text-right tabular-nums text-muted-foreground",
    subtitle: "text-[11px] text-muted-foreground/80",
  },
  popover: {
    item: "space-y-0.5",
    row: "flex items-center justify-between gap-2 leading-tight",
    label: "text-[11px] font-medium text-foreground",
    value: "text-right text-[length:var(--app-font-size-chat-meta,10px)] text-muted-foreground",
    subtitle:
      "text-[length:var(--app-font-size-chat-meta,10px)] leading-tight text-muted-foreground/80",
  },
};

function localizeUsageLineLabel(i18n: I18n, label: string): string {
  switch (label) {
    case "24h":
      return i18n._("24h");
    case "7d":
      return i18n._("7d");
    case "30d":
      return i18n._("30d");
    case "Credits":
      return i18n._("Credits");
    case "On-demand":
      return i18n._("On-demand");
    case "Extra usage":
      return i18n._("Extra usage");
    default:
      return label;
  }
}

function localizeUsageLineValue(i18n: I18n, value: string): string {
  const tokensMatch = /^(.+) tokens$/u.exec(value);
  if (tokensMatch) {
    return i18n._("{count} tokens", { count: tokensMatch[1]! });
  }
  const remainingOfMatch = /^(.+) of (.+) remaining$/u.exec(value);
  if (remainingOfMatch) {
    return i18n._("{remaining} of {total} remaining", {
      remaining: remainingOfMatch[1]!,
      total: remainingOfMatch[2]!,
    });
  }
  const remainingMatch = /^(.+) remaining$/u.exec(value);
  if (remainingMatch) {
    return i18n._("{remaining} remaining", { remaining: remainingMatch[1]! });
  }
  const spentMatch = /^(.+) spent$/u.exec(value);
  if (spentMatch) {
    return i18n._("{amount} spent", { amount: spentMatch[1]! });
  }
  const limitMatch = /^(.+) limit$/u.exec(value);
  if (limitMatch) {
    return i18n._("{amount} limit", { amount: limitMatch[1]! });
  }
  const usedOfMatch = /^(.+) of (.+)$/u.exec(value);
  if (usedOfMatch) {
    return i18n._("{used} of {limit}", {
      used: usedOfMatch[1]!,
      limit: usedOfMatch[2]!,
    });
  }
  return value;
}

function localizeUsageLineSubtitle(i18n: I18n, subtitle: string): string {
  const match = /^(.+) recent (session|sessions)$/u.exec(subtitle);
  if (!match) return subtitle;
  return i18n._("{count} recent sessions", { count: match[1]! });
}

export function ProviderUsageLineList({
  className,
  lines,
  surface,
}: {
  className?: string | undefined;
  lines: ReadonlyArray<OpenUsageUsageLine>;
  surface: ProviderUsageLineListSurface;
}) {
  const { i18n } = useLingui();
  const classes = SURFACE_CLASSES[surface];

  return (
    <div className={cn("space-y-1.5", className)}>
      {lines.map((line) => (
        <div key={`${line.label}:${line.value}`} className={classes.item}>
          <div className={classes.row}>
            <span className={classes.label}>{localizeUsageLineLabel(i18n, line.label)}</span>
            <span className={classes.value}>{localizeUsageLineValue(i18n, line.value)}</span>
          </div>
          {line.subtitle ? (
            <div className={classes.subtitle}>{localizeUsageLineSubtitle(i18n, line.subtitle)}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

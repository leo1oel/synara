import { t } from "~/i18n";

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
    row: "flex items-center justify-between gap-2 text-ui leading-snug",
    label: "font-medium text-foreground",
    value: "text-right tabular-nums text-muted-foreground",
    subtitle: "text-ui-sm text-muted-foreground/80",
  },
  popover: {
    item: "space-y-0.5",
    row: "flex items-center justify-between gap-2 leading-tight",
    label: "text-ui-sm font-medium text-foreground",
    value: "text-right text-chat-meta text-muted-foreground",
    subtitle: "text-chat-meta leading-tight text-muted-foreground/80",
  },
};

function localizeUsageLineLabel(translate: typeof t, label: string): string {
  switch (label) {
    case "24h":
      return translate("lattice:n24h");
    case "7d":
      return translate("lattice:n7d");
    case "30d":
      return translate("lattice:n30d");
    case "Credits":
      return translate("lattice:credits");
    case "On-demand":
      return translate("lattice:onDemand");
    case "Extra usage":
      return translate("lattice:extraUsage");
    default:
      return label;
  }
}

function localizeUsageLineValue(translate: typeof t, value: string): string {
  const tokensMatch = /^(.+) tokens$/u.exec(value);
  if (tokensMatch) {
    return translate("chat:tokens3", { count: tokensMatch[1]! });
  }
  const remainingOfMatch = /^(.+) of (.+) remaining$/u.exec(value);
  if (remainingOfMatch) {
    return translate("lattice:ofRemaining", {
      remaining: remainingOfMatch[1]!,
      total: remainingOfMatch[2]!,
    });
  }
  const remainingEstimateMatch = /^(.+) remaining \(≈ (.+)\)$/u.exec(value);
  if (remainingEstimateMatch) {
    return translate("lattice:remaining", {
      remaining: remainingEstimateMatch[1]!,
      estimate: remainingEstimateMatch[2]!,
    });
  }
  const remainingMatch = /^(.+) remaining$/u.exec(value);
  if (remainingMatch) {
    return translate("settings:usageRemaining", { window: remainingMatch[1]! });
  }
  const spentMatch = /^(.+) spent$/u.exec(value);
  if (spentMatch) {
    return translate("lattice:spent", { amount: spentMatch[1]! });
  }
  const limitMatch = /^(.+) limit$/u.exec(value);
  if (limitMatch) {
    return translate("lattice:limit", { amount: limitMatch[1]! });
  }
  const usedOfMatch = /^(.+) of (.+)$/u.exec(value);
  if (usedOfMatch) {
    return translate("lattice:of", { used: usedOfMatch[1]!, limit: usedOfMatch[2]! });
  }
  return value;
}

function localizeUsageLineSubtitle(translate: typeof t, subtitle: string): string {
  const match = /^(.+) recent (session|sessions)$/u.exec(subtitle);
  if (!match) return subtitle;
  return translate("lattice:recentSessions", { count: match[1]! });
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
  const classes = SURFACE_CLASSES[surface];

  return (
    <div className={cn("space-y-1.5", className)}>
      {lines.map((line) => (
        <div key={`${line.label}:${line.value}`} className={classes.item}>
          <div className={classes.row}>
            <span className={classes.label}>{localizeUsageLineLabel(t, line.label)}</span>
            <span className={classes.value}>{localizeUsageLineValue(t, line.value)}</span>
          </div>
          {line.subtitle ? (
            <div className={classes.subtitle}>{localizeUsageLineSubtitle(t, line.subtitle)}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

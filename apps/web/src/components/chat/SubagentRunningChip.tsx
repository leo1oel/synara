// FILE: SubagentRunningChip.tsx
// Purpose: Small floating "N running ↑" chip above the composer, shown while the
// transcript card of the subagents still at work is scrolled out of view; a
// click scrolls back to that card.
// Layer: Chat transcript UI
// Exports: SubagentRunningChip

import { t, useTranslation } from "~/i18n";
import { pluralize } from "~/i18n/pluralize";

import { ArrowDownIcon, ArrowUpIcon } from "~/lib/icons";
import { subagentStatusTextToneClassName } from "~/lib/subagentPresentation";
import { cn } from "~/lib/utils";
import { LiveStatusSpinner } from "../ui/spinner";

export function SubagentRunningChip({
  runningCount,
  direction,
  visible,
  onClick,
}: {
  runningCount: number;
  /** Where the card is relative to the viewport. */
  direction: "above" | "below";
  visible: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();

  const Arrow = direction === "below" ? ArrowDownIcon : ArrowUpIcon;
  return (
    <button
      type="button"
      data-testid="subagent-running-chip"
      data-scroll-anchor-ignore
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      aria-label={
        runningCount === 1
          ? t("lattice:n1SubagentRunningShowIt")
          : t("lattice:subagentsRunningShowThem", { count: runningCount })
      }
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)] py-1 pr-2 pl-2.5 text-ui-sm text-foreground/85 backdrop-blur-md hover:cursor-pointer",
        "hover:bg-[image:linear-gradient(var(--color-background-elevated-secondary),var(--color-background-elevated-secondary))]",
        visible ? "pointer-events-auto" : "pointer-events-none",
      )}
    >
      <LiveStatusSpinner
        className={cn("size-3 shrink-0", subagentStatusTextToneClassName("running"))}
      />
      <span className="tabular-nums">
        {t("chat:backgroundTasksRunning", { count: runningCount })}
      </span>
      <span aria-hidden="true" className="h-3 w-px bg-[var(--color-border)]" />
      <Arrow aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
    </button>
  );
}

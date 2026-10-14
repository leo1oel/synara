// FILE: CodexFollowUpChips.tsx
// Purpose: The suggested next prompts a Codex reply ends with, as chips under
// the reply; choosing one writes its prompt into the composer.
// Layer: Chat presentation

import { useLingui } from "@lingui/react";
import { memo } from "react";

import type { CodexFollowUp } from "~/lib/codexFollowUps";

export const CodexFollowUpChips = memo(function CodexFollowUpChips({
  followUps,
  onSelect,
}: {
  followUps: readonly CodexFollowUp[];
  onSelect: (prompt: string) => void;
}) {
  const { i18n } = useLingui();
  return (
    <div
      role="group"
      aria-label={i18n._("Suggested follow-ups")}
      className="mt-2.5 flex min-w-0 flex-wrap gap-1.5"
    >
      {followUps.map((followUp, index) => (
        <button
          // Labels may repeat; the order is the reply's own and never changes.
          // oxlint-disable-next-line no-array-index-key
          key={index}
          type="button"
          title={followUp.prompt}
          className="codex-follow-up flex h-7 max-w-full min-w-0 items-center rounded-full border border-[color:var(--color-border-light)] px-3 text-ui text-foreground transition-colors duration-150 hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none"
          onClick={() => onSelect(followUp.prompt)}
        >
          <span className="min-w-0 truncate">{followUp.label}</span>
        </button>
      ))}
    </div>
  );
});

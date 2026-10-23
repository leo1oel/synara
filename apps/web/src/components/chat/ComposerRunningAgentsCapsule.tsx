// FILE: ComposerRunningAgentsCapsule.tsx
// Purpose: Compact "N agents running" capsule above the composer while any of the
// thread's subagents is still at work, during the turn and after it settles. A
// click brings the newest running agent's transcript card into view.
// Layer: Chat composer UI
// Exports: ComposerRunningAgentsCapsule

import { i18n } from "~/i18n";
import { BotIcon } from "~/lib/icons";
import { ComposerCapsule } from "./ComposerCapsule";
import { COMPOSER_STACKED_PANEL_ICON_CLASS_NAME } from "./composerStackedPanelStyles";

interface ComposerRunningAgentsCapsuleProps {
  count: number;
  /** Scrolls to the running agent; omitted when no transcript row stands for it. */
  onShow?: (() => void) | undefined;
}

export function ComposerRunningAgentsCapsule({ count, onShow }: ComposerRunningAgentsCapsuleProps) {
  return (
    <ComposerCapsule
      icon={<BotIcon className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME} />}
      onClick={onShow}
      testId="running-agents-capsule"
    >
      {count === 1 ? i18n._("1 agent running") : i18n._("{count} agents running", { count })}
    </ComposerCapsule>
  );
}

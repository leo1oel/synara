// FILE: ComposerClaudeNotice.tsx
// Purpose: Say a Claude problem right above the composer, in full and with its next
//          step: a calm warning block (no modal), dismissible per problem. The block
//          wraps instead of truncating, so a narrow agent panel still shows the reason.
//          With no agent CLI found at all it says which agents Lattice runs, how to
//          install and sign in to each, and offers Set path… and Check again.
// Layer: Chat composer UI

import { useState } from "react";

import { CommandLine } from "~/components/CommandLine";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { useTranslation } from "~/i18n";
import { Translation } from "~/i18n/Translation";
import { TriangleAlertIcon, XIcon } from "~/lib/icons";

import type { ClaudeComposerNotice as Notice } from "./claudeComposerNotice";

const INLINE_COMMAND = <code className="font-mono" />;

/** The agents Lattice runs, by product name (the same in every language), with the one
 *  install command that needs nothing else (Codex's line adds Homebrew) and the sign-in. */
const AGENT_SETUP_STEPS = [
  {
    id: "claude",
    name: "Claude Code",
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    signIn: () => (
      <Translation
        message="lattice:agentSetup_claudeSignIn"
        components={{ command: INLINE_COMMAND }}
      />
    ),
  },
  {
    id: "codex",
    name: "Codex",
    install: "npm install -g @openai/codex",
    signIn: () => (
      <Translation
        message="lattice:agentSetup_codexSignIn"
        components={{ command: INLINE_COMMAND }}
      />
    ),
  },
] as const;

/** No Claude Code or Codex found: what Lattice runs, how to get one, and where to point it. */
function AgentSetupNotice(props: {
  readonly title: string;
  readonly onSetPath: () => void;
  readonly onRecheck: () => Promise<unknown>;
  readonly onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  // The block stays mounted while nothing is found, so a finished check says so.
  const [checkedOnce, setCheckedOnce] = useState(false);
  const recheck = () => {
    setChecking(true);
    void props.onRecheck().finally(() => {
      setChecking(false);
      setCheckedOnce(true);
    });
  };
  return (
    <div
      className="mb-2 flex items-start gap-2 rounded-xl border border-warning/32 bg-warning/4 py-2 ps-3 pe-1.5 text-ui"
      role="status"
      data-testid="composer-claude-notice"
      data-notice-kind="agent-setup"
    >
      <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <span className="flex min-w-0 flex-1 flex-col items-stretch gap-1.5 text-[var(--color-text-foreground)]">
        <span className="font-medium">{props.title}</span>
        <span className="text-muted-foreground">{t("lattice:agentSetup_intro")}</span>
        {AGENT_SETUP_STEPS.map((step) => (
          <span
            key={step.id}
            className="flex flex-col gap-1"
            data-testid={`agent-setup-${step.id}`}
          >
            <span className="font-medium">{step.name}</span>
            <CommandLine command={step.install} />
            <span className="text-ui-sm text-muted-foreground">{step.signIn()}</span>
          </span>
        ))}
        <span className="text-muted-foreground">
          {checkedOnce && !checking ? `${t("lattice:agentSetup_stillNotFound")} ` : null}
          {t("lattice:agentSetup_alreadyInstalled")}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="outline" size="xs" onClick={props.onSetPath}>
            {t("lattice:agentSetup_setPath")}
          </Button>
          <Button type="button" variant="outline" size="xs" disabled={checking} onClick={recheck}>
            {checking ? t("lattice:agentSetup_checking") : t("settings:checkAgain")}
          </Button>
        </span>
      </span>
      <IconButton
        variant="ghost"
        size="icon-chip"
        className="size-5 shrink-0 rounded-full sm:size-5"
        label={t("chat:dismissTip")}
        onClick={props.onDismiss}
      >
        <XIcon />
      </IconButton>
    </div>
  );
}

export function ComposerClaudeNotice(props: {
  readonly notice: Notice;
  readonly onChangeModel: () => void;
  readonly onOpenProviderSettings: () => void;
  /** Settings → Providers with the Claude Code and Codex binary paths open. */
  readonly onSetPath: () => void;
  readonly onRecheck: () => Promise<unknown>;
  readonly onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { notice } = props;
  if (notice.kind === "agent-setup") {
    return (
      <AgentSetupNotice
        title={notice.message}
        onSetPath={props.onSetPath}
        onRecheck={props.onRecheck}
        onDismiss={props.onDismiss}
      />
    );
  }
  return (
    <div
      className="mb-2 flex items-start gap-2 rounded-xl border border-warning/32 bg-warning/4 py-2 ps-3 pe-1.5 text-ui"
      role="status"
      data-testid="composer-claude-notice"
      data-notice-kind={notice.kind}
    >
      <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warning" />
      {/* The action sits under the message so a narrow panel keeps the message readable. */}
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <span className="text-[var(--color-text-foreground)]">{notice.message}</span>
        {notice.action ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={
              notice.action === "change-model" ? props.onChangeModel : props.onOpenProviderSettings
            }
          >
            {notice.action === "change-model"
              ? t("chat:providerModelPicker_changeModel")
              : t("lattice:providerSettings")}
          </Button>
        ) : null}
      </span>
      <IconButton
        variant="ghost"
        size="icon-chip"
        className="size-5 shrink-0 rounded-full sm:size-5"
        label={t("chat:dismissTip")}
        onClick={props.onDismiss}
      >
        <XIcon />
      </IconButton>
    </div>
  );
}

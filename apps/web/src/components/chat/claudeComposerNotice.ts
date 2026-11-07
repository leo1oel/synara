// FILE: claudeComposerNotice.ts
// Purpose: Decide the one Claude problem worth saying next to the composer, where the
//          writer is looking: no agent CLI was found at all, the composer just left a
//          model the account refused, the last turn failed for a Claude reason, or
//          Claude's status makes sends fail. The transcript card and the provider banner
//          say it too, but they can sit out of view (clamped, scrolled, at the top of a
//          narrow panel).
// Layer: Chat composer helpers (pure)

import type { ServerProviderStatus } from "@synara/contracts";

/** Codes the Claude adapter puts on a failed turn (see workLog's CLAUDE_EXIT_NEXT_STEPS). */
const CLAUDE_TURN_FAILURE_CODES = new Set([
  "claude_cli_outdated",
  "claude_auth_required",
  "claude_access_forbidden",
  "claude_model_unavailable",
  "model_not_found",
  "claude_cli_failed",
]);
const MODEL_FAILURE_CODES = new Set(["claude_model_unavailable", "model_not_found"]);

/** ProviderHealth's status line when the `claude` / `codex` executable is not found. */
const AGENT_CLI_MISSING_MESSAGES = new Set([
  "Claude Agent CLI (`claude`) is not installed or not on PATH.",
  "Codex CLI (`codex`) is not installed or not on PATH.",
]);
const AGENT_CLI_PROVIDERS = new Set(["claudeAgent", "codex"]);

/**
 * Whether there is no agent to run: every enabled Claude Code and Codex status says its
 * CLI was not found (also when a binary path set in Provider settings is wrong), and no
 * other provider is ready. A CLI that is found but signed out or outdated is not missing:
 * its own status line says what to do.
 */
export function needsAgentCliSetup(statuses: ReadonlyArray<ServerProviderStatus>): boolean {
  let missing = false;
  for (const status of statuses) {
    if (status.enabled === false) continue;
    if (AGENT_CLI_PROVIDERS.has(status.driver ?? status.provider)) {
      if (!status.message || !AGENT_CLI_MISSING_MESSAGES.has(status.message)) return false;
      missing = true;
    } else if (status.status === "ready" && status.available) {
      return false;
    }
  }
  return missing;
}

export type ClaudeComposerNoticeAction = "change-model" | "provider-settings" | "set-path";

export interface ClaudeComposerNotice {
  /** Changes whenever the notice is about something new, so a dismissal does not stick. */
  readonly key: string;
  readonly kind: "agent-setup" | "model-switched" | "turn-failed" | "provider-status";
  readonly message: string;
  readonly action: ClaudeComposerNoticeAction | null;
  /** Also mark the model chip: the problem is still in the way of the next send. */
  readonly blocksNextSend: boolean;
}

export interface ClaudeComposerModelSwitch {
  readonly threadId: string;
  /** The latest turn when the switch happened (part of the key; the caller retires the
   *  switch once a new turn starts). */
  readonly turnId: string | null;
  readonly fromName: string;
  readonly toModel: string;
  readonly toName: string;
}

export function resolveClaudeComposerNotice(input: {
  readonly provider: string;
  readonly threadId: string | null;
  readonly selectedModel: string;
  readonly latestTurnId: string | null;
  readonly latestTurnFailure: {
    readonly errorCode?: string | undefined;
    readonly nextStep?: string | undefined;
  } | null;
  readonly providerStatus: ServerProviderStatus | null;
  readonly modelSwitch: ClaudeComposerModelSwitch | null;
  readonly translateStatus: (message: string) => string;
  readonly describeSwitch: (from: string, to: string) => string;
  /** `needsAgentCliSetup` of every provider status, whichever provider is selected. */
  readonly agentCliSetupNeeded?: { readonly message: string } | null;
}): ClaudeComposerNotice | null {
  // Nothing else matters until there is an agent to run.
  if (input.agentCliSetupNeeded) {
    return {
      key: "agent-setup",
      kind: "agent-setup",
      message: input.agentCliSetupNeeded.message,
      action: "set-path",
      blocksNextSend: true,
    };
  }
  if (input.provider !== "claudeAgent") return null;

  const modelSwitch = input.modelSwitch;
  if (
    modelSwitch &&
    modelSwitch.threadId === input.threadId &&
    modelSwitch.toModel === input.selectedModel
  ) {
    return {
      key: `model-switched:${modelSwitch.turnId ?? ""}:${modelSwitch.fromName}:${modelSwitch.toModel}`,
      kind: "model-switched",
      message: input.describeSwitch(modelSwitch.fromName, modelSwitch.toName),
      action: "change-model",
      blocksNextSend: false,
    };
  }

  // A status that blocks sends right now outranks the last turn's failure.
  const status = input.providerStatus;
  const statusNotice =
    status && status.status !== "ready" && status.message
      ? {
          key: `provider-status:${status.instanceId ?? status.provider}:${status.message}`,
          kind: "provider-status" as const,
          message: input.translateStatus(status.message),
          action: "provider-settings" as const,
          blocksNextSend: status.status === "error",
        }
      : null;
  if (statusNotice?.blocksNextSend) return statusNotice;

  const failure = input.latestTurnFailure;
  if (
    failure?.errorCode &&
    CLAUDE_TURN_FAILURE_CODES.has(failure.errorCode) &&
    failure.nextStep &&
    input.latestTurnId
  ) {
    const aboutModel = MODEL_FAILURE_CODES.has(failure.errorCode);
    return {
      key: `turn-failed:${input.latestTurnId}`,
      kind: "turn-failed",
      message: failure.nextStep,
      // A refused account or network needs another provider; a refused model, another model.
      action:
        aboutModel || failure.errorCode === "claude_access_forbidden"
          ? "change-model"
          : "provider-settings",
      blocksNextSend: true,
    };
  }

  if (statusNotice) return statusNotice;
  return null;
}

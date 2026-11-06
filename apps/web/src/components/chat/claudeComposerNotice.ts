// FILE: claudeComposerNotice.ts
// Purpose: Decide the one Claude problem worth saying next to the composer, where the
//          writer is looking: the composer just left a model the account refused, the
//          last turn failed for a Claude reason, or Claude's status makes sends fail.
//          The transcript card and the provider banner say it too, but they can sit out
//          of view (clamped, scrolled, at the top of a narrow panel).
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

export type ClaudeComposerNoticeAction = "change-model" | "provider-settings";

export interface ClaudeComposerNotice {
  /** Changes whenever the notice is about something new, so a dismissal does not stick. */
  readonly key: string;
  readonly kind: "model-switched" | "turn-failed" | "provider-status";
  readonly message: string;
  readonly action: ClaudeComposerNoticeAction | null;
  /** Also mark the model chip: the problem is still in the way of the next send. */
  readonly blocksNextSend: boolean;
}

export interface ClaudeComposerModelSwitch {
  readonly threadId: string;
  /** The latest turn when the switch happened; a new turn retires the notice. */
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
}): ClaudeComposerNotice | null {
  if (input.provider !== "claudeAgent") return null;

  const modelSwitch = input.modelSwitch;
  if (
    modelSwitch &&
    modelSwitch.threadId === input.threadId &&
    modelSwitch.turnId === input.latestTurnId &&
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

  const status = input.providerStatus;
  if (status && status.status !== "ready" && status.message) {
    return {
      key: `provider-status:${status.instanceId ?? status.provider}:${status.message}`,
      kind: "provider-status",
      message: input.translateStatus(status.message),
      action: "provider-settings",
      blocksNextSend: status.status === "error",
    };
  }
  return null;
}

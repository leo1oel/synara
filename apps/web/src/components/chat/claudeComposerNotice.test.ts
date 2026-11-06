import type { ServerProviderStatus } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { resolveClaudeComposerNotice } from "./claudeComposerNotice";

const ready: ServerProviderStatus = {
  provider: "claudeAgent",
  driver: "claudeAgent",
  instanceId: "claudeAgent" as ServerProviderStatus["instanceId"],
  status: "ready",
  available: true,
  authStatus: "authenticated",
  checkedAt: "2026-11-06T10:00:00.000Z",
};

const base = {
  provider: "claudeAgent",
  threadId: "t1",
  selectedModel: "claude-sonnet-5",
  latestTurnId: "turn-1",
  latestTurnFailure: null,
  providerStatus: ready,
  modelSwitch: null,
  translateStatus: (message: string) => `«${message}»`,
  describeSwitch: (from: string, to: string) => `${from} → ${to}`,
};

describe("resolveClaudeComposerNotice", () => {
  it("says nothing when Claude is fine, or for another provider", () => {
    expect(resolveClaudeComposerNotice(base)).toBeNull();
    expect(
      resolveClaudeComposerNotice({
        ...base,
        provider: "codex",
        providerStatus: { ...ready, status: "error", message: "x" },
      }),
    ).toBeNull();
  });

  it("says the composer switched models, while it still sits on the replacement", () => {
    const modelSwitch = {
      threadId: "t1",
      turnId: "turn-1",
      fromName: "Fable 5.1",
      toModel: "claude-sonnet-5",
      toName: "Sonnet 5",
    };
    const failure = { errorCode: "model_not_found", nextStep: "Pick another model." };
    expect(
      resolveClaudeComposerNotice({ ...base, modelSwitch, latestTurnFailure: failure }),
    ).toMatchObject({
      kind: "model-switched",
      message: "Fable 5.1 → Sonnet 5",
      action: "change-model",
      blocksNextSend: false,
    });
    // Another model picked, or a new turn, retires it.
    expect(
      resolveClaudeComposerNotice({ ...base, modelSwitch, selectedModel: "claude-opus-5" })?.kind,
    ).not.toBe("model-switched");
    expect(
      resolveClaudeComposerNotice({ ...base, modelSwitch, latestTurnId: "turn-2" }),
    ).toBeNull();
  });

  it.each([
    ["claude_access_forbidden", "change-model"],
    ["claude_auth_required", "provider-settings"],
    ["claude_cli_outdated", "provider-settings"],
    ["model_not_found", "change-model"],
  ])("brings a %s turn's next step to the composer", (errorCode, action) => {
    expect(
      resolveClaudeComposerNotice({
        ...base,
        latestTurnFailure: { errorCode, nextStep: "What to do." },
      }),
    ).toEqual({
      key: "turn-failed:turn-1",
      kind: "turn-failed",
      message: "What to do.",
      action,
      blocksNextSend: true,
    });
  });

  it("ignores failures that are not Claude's to explain", () => {
    expect(
      resolveClaudeComposerNotice({
        ...base,
        latestTurnFailure: { errorCode: "server_overloaded", nextStep: "Retry." },
      }),
    ).toBeNull();
  });

  it("shows an unusable Claude status, localized", () => {
    expect(
      resolveClaudeComposerNotice({
        ...base,
        providerStatus: {
          ...ready,
          status: "error",
          message: "Claude Code 1.0.100 is too old. Run `claude update` in Terminal.",
        },
      }),
    ).toMatchObject({
      kind: "provider-status",
      message: "«Claude Code 1.0.100 is too old. Run `claude update` in Terminal.»",
      action: "provider-settings",
      blocksNextSend: true,
    });
  });

  it("puts a status that blocks sends ahead of an older turn failure", () => {
    const notice = resolveClaudeComposerNotice({
      ...base,
      latestTurnFailure: { errorCode: "claude_access_forbidden", nextStep: "Refused." },
      providerStatus: {
        ...ready,
        status: "error",
        authStatus: "unauthenticated",
        message: "Claude is not authenticated. Run `claude auth login` and try again.",
      },
    });
    expect(notice?.kind).toBe("provider-status");
    // A mere warning status does not hide the turn's own reason.
    expect(
      resolveClaudeComposerNotice({
        ...base,
        latestTurnFailure: { errorCode: "claude_access_forbidden", nextStep: "Refused." },
        providerStatus: { ...ready, status: "warning", message: "Could not verify." },
      })?.kind,
    ).toBe("turn-failed");
  });
});

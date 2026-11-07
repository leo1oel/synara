import type { ServerProviderStatus } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { needsAgentCliSetup, resolveClaudeComposerNotice } from "./claudeComposerNotice";

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
    // Another model picked, or another thread, retires it.
    expect(
      resolveClaudeComposerNotice({ ...base, modelSwitch, selectedModel: "claude-opus-5" })?.kind,
    ).not.toBe("model-switched");
    expect(resolveClaudeComposerNotice({ ...base, modelSwitch, threadId: "t2" })).toBeNull();
    // The failed turn may become the latest only after the switch: still the switch.
    expect(
      resolveClaudeComposerNotice({
        ...base,
        modelSwitch: { ...modelSwitch, turnId: null },
        latestTurnFailure: failure,
      })?.kind,
    ).toBe("model-switched");
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

describe("needsAgentCliSetup", () => {
  const claudeMissing: ServerProviderStatus = {
    ...ready,
    status: "error",
    available: false,
    authStatus: "unknown",
    message: "Claude Agent CLI (`claude`) is not installed or not on PATH.",
  };
  const codexMissing: ServerProviderStatus = {
    ...claudeMissing,
    provider: "codex",
    driver: "codex",
    instanceId: "codex" as ServerProviderStatus["instanceId"],
    message: "Codex CLI (`codex`) is not installed or not on PATH.",
  };
  const cursor = (status: "ready" | "error"): ServerProviderStatus => ({
    ...ready,
    provider: "cursor",
    driver: "cursor",
    instanceId: "cursor" as ServerProviderStatus["instanceId"],
    status,
    available: status === "ready",
  });

  it("holds when neither Claude Code nor Codex is found and nothing else is ready", () => {
    expect(needsAgentCliSetup([claudeMissing, codexMissing, cursor("error")])).toBe(true);
    // A disabled provider is out of the picture either way.
    expect(needsAgentCliSetup([claudeMissing, { ...codexMissing, enabled: false }])).toBe(true);
  });

  it("does not hold once one agent is found, signed in or not, or another one is ready", () => {
    expect(
      needsAgentCliSetup([
        claudeMissing,
        { ...codexMissing, status: "ready", available: true, message: undefined },
      ]),
    ).toBe(false);
    const signedOut = {
      ...ready,
      status: "error" as const,
      available: false,
      message: "Claude is not authenticated. Run `claude auth login` and try again.",
    };
    expect(needsAgentCliSetup([signedOut, codexMissing])).toBe(false);
    expect(needsAgentCliSetup([claudeMissing, codexMissing, cursor("ready")])).toBe(false);
    // Statuses not loaded yet.
    expect(needsAgentCliSetup([])).toBe(false);
  });

  it("outranks every other notice, whichever provider is selected", () => {
    const setup = { message: "Lattice can't find Claude Code or Codex" };
    const failure = { errorCode: "claude_cli_failed", nextStep: "Run `claude -p hi`." };
    for (const provider of ["claudeAgent", "codex"]) {
      expect(
        resolveClaudeComposerNotice({
          ...base,
          provider,
          providerStatus: claudeMissing,
          latestTurnFailure: failure,
          agentCliSetupNeeded: setup,
        }),
      ).toEqual({
        key: "agent-setup",
        kind: "agent-setup",
        message: setup.message,
        action: "set-path",
        blocksNextSend: true,
      });
    }
  });
});

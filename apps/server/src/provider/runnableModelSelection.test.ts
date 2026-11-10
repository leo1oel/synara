import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type ProviderKind,
  type ServerProviderStatus,
  type ServerSettings,
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { resolveRunnableModelSelection } from "./runnableModelSelection.ts";

function status(
  provider: ProviderKind,
  health: "ready" | "missing" | "signed-out" = "ready",
): ServerProviderStatus {
  return {
    provider,
    driver: provider,
    instanceId: provider,
    enabled: true,
    status: health === "ready" ? "ready" : "error",
    available: health !== "missing",
    authStatus: health === "signed-out" ? "unauthenticated" : "authenticated",
    checkedAt: "2026-01-01T00:00:00.000Z",
  } as ServerProviderStatus;
}

const settings = DEFAULT_SERVER_SETTINGS;
const codexDefault = settings.textGenerationModelSelection;
const claude: ModelSelection = { provider: "claudeAgent", model: "claude-opus-5-5" };

describe("resolveRunnableModelSelection", () => {
  it("falls back to the first ready provider's default model when the default Codex is missing", () => {
    expect(
      resolveRunnableModelSelection({
        settings,
        preferences: [codexDefault],
        statuses: [status("codex", "missing"), status("claudeAgent")],
        purpose: "text-generation",
      }),
    ).toEqual({
      kind: "fallback",
      selection: {
        provider: "claudeAgent",
        instanceId: "claudeAgent",
        model: DEFAULT_MODEL_BY_PROVIDER.claudeAgent,
      },
    });
  });

  it("keeps a ready Settings choice even when an earlier provider is also ready", () => {
    expect(
      resolveRunnableModelSelection({
        settings,
        preferences: [claude],
        statuses: [status("codex"), status("claudeAgent")],
        purpose: "text-generation",
      }),
    ).toEqual({ kind: "selected", preference: 0, selection: claude });
  });

  it("keeps a Settings choice whose health has not been probed yet", () => {
    expect(
      resolveRunnableModelSelection({
        settings,
        preferences: [claude],
        statuses: [],
        purpose: "text-generation",
      }),
    ).toMatchObject({ kind: "selected", selection: claude });
  });

  it("tries each preference before falling back, skipping signed-out providers", () => {
    expect(
      resolveRunnableModelSelection({
        settings,
        preferences: [codexDefault, claude],
        statuses: [status("codex", "signed-out"), status("claudeAgent")],
        purpose: "text-generation",
      }),
    ).toEqual({ kind: "selected", preference: 1, selection: claude });
  });

  it("never falls back to a provider disabled in settings, even when it is installed", () => {
    const codexOff: ServerSettings = {
      ...settings,
      providers: {
        ...settings.providers,
        codex: { ...settings.providers.codex, enabled: false },
      },
    };
    expect(
      resolveRunnableModelSelection({
        settings: codexOff,
        preferences: [codexDefault],
        statuses: [status("codex"), status("claudeAgent", "missing")],
        purpose: "text-generation",
      }),
    ).toMatchObject({ kind: "unavailable" });
  });

  it("lets an agent-turn purpose (compile repair) fall back to any built-in provider", () => {
    const grokOnly = [status("codex", "missing"), status("claudeAgent", "missing"), status("grok")];
    expect(
      resolveRunnableModelSelection({
        settings,
        preferences: [settings.compileRepairModelSelection],
        statuses: grokOnly,
        purpose: "agent-turn",
      }),
    ).toMatchObject({ kind: "fallback", selection: { provider: "grok" } });
    // Grok has no text-generation path, so proofreading cannot use it.
    expect(
      resolveRunnableModelSelection({
        settings,
        preferences: [codexDefault],
        statuses: grokOnly,
        purpose: "text-generation",
      }),
    ).toMatchObject({ kind: "unavailable" });
  });

  it("names the enabled providers that can be connected, and where", () => {
    expect(
      resolveRunnableModelSelection({
        settings,
        preferences: [codexDefault],
        statuses: [status("codex", "missing"), status("claudeAgent", "signed-out")],
        purpose: "text-generation",
      }),
    ).toEqual({
      kind: "unavailable",
      message:
        "No AI provider is connected. Connect Codex, Claude, Cursor, OpenCode or Droid in the Agent panel → Settings → Providers.",
    });
  });
});

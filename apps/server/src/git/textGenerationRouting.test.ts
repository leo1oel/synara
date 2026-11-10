import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type ProviderKind,
  type ServerProviderStatus,
  type ServerSettings,
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { resolveTextGenerationRouting } from "./textGenerationRouting.ts";

function status(provider: ProviderKind, available = true): ServerProviderStatus {
  return {
    provider,
    driver: provider,
    instanceId: provider,
    enabled: true,
    status: available ? "ready" : "error",
    available,
    authStatus: "authenticated",
    checkedAt: "2026-01-01T00:00:00.000Z",
  } as ServerProviderStatus;
}

const settings = DEFAULT_SERVER_SETTINGS;
const claudeOnly = [status("codex", false), status("claudeAgent")];
// What the web Git panel sends: the Settings Git writing model, echoed back.
const codexFromClient: ModelSelection = {
  provider: "codex",
  instanceId: "codex",
  model: "gpt-6-luna",
};

describe("resolveTextGenerationRouting", () => {
  it("writes the commit message with the ready provider when the Git writing model's Codex is missing", () => {
    expect(
      resolveTextGenerationRouting(settings, claudeOnly, {
        textGenerationModel: "gpt-6-luna",
        textGenerationModelSelection: codexFromClient,
        providerOptions: { codex: { homePath: "/codex-home" } },
      }),
    ).toEqual({
      model: DEFAULT_MODEL_BY_PROVIDER.claudeAgent,
      modelSelection: {
        provider: "claudeAgent",
        instanceId: "claudeAgent",
        model: DEFAULT_MODEL_BY_PROVIDER.claudeAgent,
      },
      // The Codex home the client sent belongs to the provider that was replaced.
      providerOptions: undefined,
    });
  });

  it("keeps the requested model and client options while its provider is ready", () => {
    const routing = resolveTextGenerationRouting(
      settings,
      [status("codex"), status("claudeAgent")],
      {
        textGenerationModelSelection: codexFromClient,
        providerOptions: { codex: { homePath: "/codex-home" } },
      },
    );
    expect(routing).toMatchObject({
      model: "gpt-6-luna",
      modelSelection: codexFromClient,
      providerOptions: { codex: { homePath: "/codex-home" } },
    });
  });

  it("writes a non-generating provider's request with the Git writing model", () => {
    const claudeWriter: ServerSettings = {
      ...settings,
      textGenerationModelSelection: { provider: "claudeAgent", model: "claude-opus-5-5" },
    };
    expect(
      resolveTextGenerationRouting(
        claudeWriter,
        [status("codex"), status("claudeAgent"), status("grok")],
        { textGenerationModelSelection: { provider: "grok", model: "grok-4.6" } },
      ),
    ).toMatchObject({ modelSelection: { provider: "claudeAgent", model: "claude-opus-5-5" } });
  });

  it("leaves a legacy model-only request alone", () => {
    expect(
      resolveTextGenerationRouting(settings, claudeOnly, { textGenerationModel: "gpt-5.4" }),
    ).toEqual({ model: "gpt-5.4", modelSelection: undefined, providerOptions: undefined });
  });

  it("answers what to connect when no provider can write", () => {
    expect(
      resolveTextGenerationRouting(settings, [status("codex", false)], {
        textGenerationModelSelection: codexFromClient,
      }),
    ).toEqual({
      unavailable:
        "No AI provider is connected. Connect Codex, Claude, Cursor, OpenCode or Droid in the Agent panel → Settings → Providers.",
    });
  });
});

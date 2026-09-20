import { DEFAULT_SERVER_SETTINGS, ProviderSessionStartInput } from "@synara/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { applyServerSettingsPatch, providerStartOptionsFromServerSettings } from "./serverSettings";

const decodeProviderSessionStartInput = Schema.decodeUnknownSync(ProviderSessionStartInput);

describe("compile repair selection patches", () => {
  it("keeps options on empty patches, accepts options-only patches, and drops options on model/provider changes", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      compileRepairModelSelection: {
        provider: "codex" as const,
        model: "gpt-5.4",
        options: { reasoningEffort: "high" as const },
      },
    };
    expect(
      applyServerSettingsPatch(current, { compileRepairModelSelection: {} })
        .compileRepairModelSelection,
    ).toEqual(current.compileRepairModelSelection);
    expect(
      applyServerSettingsPatch(current, {
        compileRepairModelSelection: { options: { reasoningEffort: "low" } },
      }).compileRepairModelSelection,
    ).toEqual({ provider: "codex", model: "gpt-5.4", options: { reasoningEffort: "low" } });
    expect(
      applyServerSettingsPatch(current, { compileRepairModelSelection: { model: "gpt-other" } })
        .compileRepairModelSelection,
    ).toEqual({ provider: "codex", model: "gpt-other" });
    expect(
      applyServerSettingsPatch(current, {
        compileRepairModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
      }).compileRepairModelSelection,
    ).toEqual({ provider: "claudeAgent", model: "claude-sonnet-4-6" });
    expect(current.textGenerationModelSelection).toEqual(
      DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
    );
  });
});

describe("providerStartOptionsFromServerSettings", () => {
  it("omits blank launch settings from provider session input", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        codex: {
          ...DEFAULT_SERVER_SETTINGS.providers.codex,
          binaryPath: "",
          homePath: "",
        },
        claudeAgent: {
          ...DEFAULT_SERVER_SETTINGS.providers.claudeAgent,
          binaryPath: "",
        },
        cursor: {
          ...DEFAULT_SERVER_SETTINGS.providers.cursor,
          binaryPath: "",
          apiEndpoint: "",
        },
        antigravity: {
          ...DEFAULT_SERVER_SETTINGS.providers.antigravity,
          binaryPath: "",
        },
        grok: {
          ...DEFAULT_SERVER_SETTINGS.providers.grok,
          binaryPath: "",
        },
        droid: {
          ...DEFAULT_SERVER_SETTINGS.providers.droid,
          binaryPath: "",
        },
        opencode: {
          ...DEFAULT_SERVER_SETTINGS.providers.opencode,
          binaryPath: "",
          serverUrl: "",
        },
        pi: {
          ...DEFAULT_SERVER_SETTINGS.providers.pi,
          binaryPath: "",
          agentDir: "",
        },
        devin: {
          ...DEFAULT_SERVER_SETTINGS.providers.devin,
          binaryPath: "",
        },
      },
    };

    const providerOptions = providerStartOptionsFromServerSettings(settings);

    expect(() =>
      decodeProviderSessionStartInput({
        threadId: "thread-1",
        provider: "codex",
        providerOptions,
        runtimeMode: "full-access",
      }),
    ).not.toThrow();
    expect(providerOptions.codex).toEqual({});
    expect(providerOptions.claudeAgent).toEqual({});
    expect(providerOptions.cursor).toEqual({});
    expect(providerOptions.antigravity).toEqual({});
    expect(providerOptions.grok).toEqual({});
    expect(providerOptions.droid).toEqual({});
    expect(providerOptions.opencode).toEqual({ experimentalWebSockets: false });
    expect(providerOptions.pi).toEqual({});
    expect(providerOptions.devin).toEqual({});
  });

  it("preserves configured launch settings", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        codex: {
          ...DEFAULT_SERVER_SETTINGS.providers.codex,
          binaryPath: "/custom/bin/codex",
          homePath: "/custom/codex-home",
        },
        opencode: {
          ...DEFAULT_SERVER_SETTINGS.providers.opencode,
          binaryPath: "/custom/bin/opencode",
          serverUrl: "http://127.0.0.1:4096",
          experimentalWebSockets: true,
        },
        devin: {
          ...DEFAULT_SERVER_SETTINGS.providers.devin,
          binaryPath: "/custom/bin/devin",
        },
      },
    };

    const providerOptions = providerStartOptionsFromServerSettings(settings);

    expect(providerOptions.codex).toEqual({
      binaryPath: "/custom/bin/codex",
      homePath: "/custom/codex-home",
    });
    expect(providerOptions.opencode).toEqual({
      binaryPath: "/custom/bin/opencode",
      serverUrl: "http://127.0.0.1:4096",
      experimentalWebSockets: true,
    });
    expect(providerOptions.devin).toEqual({ binaryPath: "/custom/bin/devin" });
  });
});

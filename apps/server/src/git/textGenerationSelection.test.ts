import { describe, expect, it } from "vitest";

import {
  isTextGenerationFallbackProvider,
  resolveChatTextGenerationInputForSelection,
  resolveTextGenerationInputForSelection,
} from "./textGenerationSelection.ts";

describe("Antigravity text generation", () => {
  const antigravity = {
    provider: "antigravity",
    instanceId: "antigravity",
    model: "Gemini 3.5 Flash",
  } as const;

  it("runs a Settings choice", () => {
    expect(resolveTextGenerationInputForSelection(antigravity, undefined)).toEqual({
      modelSelection: antigravity,
    });
  });

  it("never runs a chat's titles, recaps or predictions", () => {
    expect(resolveChatTextGenerationInputForSelection(antigravity, undefined)).toBeNull();
    expect(
      resolveChatTextGenerationInputForSelection(
        { provider: "cursor", instanceId: "cursor", model: "auto" },
        undefined,
      ),
    ).toEqual({ modelSelection: { provider: "cursor", instanceId: "cursor", model: "auto" } });
  });

  it("is never a fallback, like Pi", () => {
    expect(isTextGenerationFallbackProvider("antigravity")).toBe(false);
    expect(isTextGenerationFallbackProvider("pi")).toBe(false);
    expect(isTextGenerationFallbackProvider("claudeAgent")).toBe(true);
  });
});

describe("resolveTextGenerationInputForSelection", () => {
  it("routes Claude provider instances directly to text generation", () => {
    expect(
      resolveTextGenerationInputForSelection(
        {
          provider: "claudeAgent",
          instanceId: "claude_work",
          model: "claude-opus-4-6",
        },
        {
          claudeAgent: {
            homePath: "/tmp/claude-work",
            environment: { ANTHROPIC_AUTH_TOKEN: "token" },
          },
        },
      ),
    ).toEqual({
      modelSelection: {
        provider: "claudeAgent",
        instanceId: "claude_work",
        model: "claude-opus-4-6",
      },
      providerOptions: {
        claudeAgent: {
          homePath: "/tmp/claude-work",
          environment: { ANTHROPIC_AUTH_TOKEN: "token" },
        },
      },
    });
  });

  it("uses the resolved instance driver as the routing authority", () => {
    expect(
      resolveTextGenerationInputForSelection(
        {
          provider: "codex",
          instanceId: "work",
          model: "claude-opus-4-6",
          options: { reasoningEffort: "high" },
        },
        { claudeAgent: { homePath: "/tmp/claude-work" } },
        "claudeAgent",
      ),
    ).toEqual({
      modelSelection: {
        provider: "claudeAgent",
        instanceId: "work",
        model: "claude-opus-4-6",
      },
      providerOptions: { claudeAgent: { homePath: "/tmp/claude-work" } },
    });
  });
});

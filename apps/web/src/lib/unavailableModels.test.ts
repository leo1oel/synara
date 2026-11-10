import type { ServerProviderStatus } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  isModelUnavailable,
  resolveUnavailableModelFallback,
  unavailableModelsFor,
} from "./unavailableModels";

const refused = (model: string) => ({
  model,
  reason: "The selected Claude model is unavailable for this account.",
  recordedAt: "2026-11-06T10:00:00.000Z",
});

const status = (instanceId: string, models: ReadonlyArray<string>): ServerProviderStatus => ({
  provider: "claudeAgent",
  driver: "claudeAgent",
  instanceId: instanceId as ServerProviderStatus["instanceId"],
  status: "ready",
  available: true,
  authStatus: "authenticated",
  checkedAt: "2026-11-06T10:00:00.000Z",
  unavailableModels: models.map(refused),
});

const OPTIONS = [
  { slug: "claude-fable-5-1", name: "Claude Fable 5.1" },
  { slug: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  { slug: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { slug: "claude-opus-5", name: "Claude Opus 5" },
];

describe("unavailable models", () => {
  it("reads one account's refused models only", () => {
    const statuses = [status("claudeAgent", ["claude-fable-5-1"]), status("claude_work", [])];
    expect(unavailableModelsFor(statuses, "claudeAgent", "claudeAgent")).toHaveLength(1);
    expect(isModelUnavailable(statuses, "claudeAgent", "claude_work", "claude-fable-5-1")).toBe(
      false,
    );
    expect(isModelUnavailable(statuses, "codex", "claudeAgent", "claude-fable-5-1")).toBe(false);
    expect(unavailableModelsFor(undefined, "claudeAgent", "claudeAgent")).toEqual([]);
  });

  it("moves a refused model to the default, or the first usable model", () => {
    const fallback = (model: string, models: ReadonlyArray<string>) =>
      resolveUnavailableModelFallback({
        provider: "claudeAgent",
        model,
        unavailableModels: models.map(refused),
        options: OPTIONS,
      });
    expect(fallback("claude-fable-5-1", [])).toBeNull();
    expect(fallback("claude-opus-5", ["claude-fable-5-1"])).toBeNull();
    expect(fallback("claude-fable-5-1", ["claude-fable-5-1"])).toBe("claude-sonnet-5-5");
    expect(fallback("claude-sonnet-5-5", ["claude-sonnet-5-5", "claude-fable-5-1"])).toBe(
      "claude-sonnet-5",
    );
    expect(
      fallback(
        "claude-opus-5",
        OPTIONS.map((option) => option.slug),
      ),
    ).toBeNull();
  });

  it("moves to a default the installed Claude Code can run", () => {
    const fallback = (claudeCliVersion: string | null) =>
      resolveUnavailableModelFallback({
        provider: "claudeAgent",
        model: "claude-fable-5-1",
        unavailableModels: [refused("claude-fable-5-1")],
        options: OPTIONS,
        claudeCliVersion,
      });
    expect(fallback("2.1.283")).toBe("claude-sonnet-5");
    expect(fallback("2.1.284")).toBe("claude-sonnet-5-5");
    expect(fallback(null)).toBe("claude-sonnet-5-5");
  });
});

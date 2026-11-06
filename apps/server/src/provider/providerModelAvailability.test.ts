import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearUnavailableModel,
  clearUnavailableModelsRecordedBefore,
  recordUnavailableModel,
  resetUnavailableModelsForTest,
  subscribeUnavailableModelChanges,
  unavailableModelsFor,
} from "./providerModelAvailability.ts";

const reason = "The selected Claude model is unavailable for this account.";

describe("providerModelAvailability", () => {
  afterEach(() => resetUnavailableModelsForTest());

  it("keeps one entry per instance and model, and notifies on every change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUnavailableModelChanges(listener);
    recordUnavailableModel({ instanceId: "claudeAgent", model: "claude-fable-5-1", reason });
    recordUnavailableModel({
      instanceId: "claudeAgent",
      model: " claude-fable-5-1 ",
      reason: "again",
      recordedAt: "2026-01-01T00:00:00.000Z",
    });
    recordUnavailableModel({ instanceId: "claude_work", model: "claude-opus-5", reason });

    expect(unavailableModelsFor("claudeAgent")).toEqual([
      { model: "claude-fable-5-1", reason: "again", recordedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(unavailableModelsFor("claude_work").map((entry) => entry.model)).toEqual([
      "claude-opus-5",
    ]);
    expect(listener).toHaveBeenCalledTimes(3);

    expect(clearUnavailableModel({ instanceId: "claudeAgent", model: "claude-opus-5" })).toBe(
      false,
    );
    expect(clearUnavailableModel({ instanceId: "claudeAgent", model: "claude-fable-5-1" })).toBe(
      true,
    );
    expect(unavailableModelsFor("claudeAgent")).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it("clears only entries recorded before a refresh began", () => {
    recordUnavailableModel({
      instanceId: "claudeAgent",
      model: "old",
      reason,
      recordedAt: "2026-01-01T00:00:00.000Z",
    });
    recordUnavailableModel({
      instanceId: "claudeAgent",
      model: "new",
      reason,
      recordedAt: "2026-01-01T00:01:00.000Z",
    });

    expect(
      clearUnavailableModelsRecordedBefore({
        instanceId: "claudeAgent",
        before: Date.parse("2026-01-01T00:00:30.000Z"),
      }),
    ).toBe(true);
    expect(unavailableModelsFor("claudeAgent").map((entry) => entry.model)).toEqual(["new"]);
  });

  it("ignores an empty model or reason", () => {
    recordUnavailableModel({ instanceId: "claudeAgent", model: " ", reason });
    recordUnavailableModel({ instanceId: "claudeAgent", model: "x", reason: "" });
    expect(unavailableModelsFor("claudeAgent")).toEqual([]);
  });
});

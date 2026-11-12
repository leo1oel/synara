import { describe, expect, it } from "vitest";

import type { TurnDispatchSettings } from "../components/ChatView.logic";
import {
  appendComposerPromptDraft,
  buildComposerPromptTurn,
  resolveComposerPromptSendRoute,
} from "./latticeComposerPrompt";

const idle = {
  hasPendingApproval: false,
  hasPendingUserInput: false,
  providerUsable: true,
  hasLiveTurn: false,
  isSendBusy: false,
  isConnecting: false,
  queuedTurnCount: 0,
};

describe("appendComposerPromptDraft", () => {
  it("replaces an empty composer and appends to a draft on a new line", () => {
    expect(appendComposerPromptDraft("", "Apply the comments")).toBe("Apply the comments");
    expect(appendComposerPromptDraft("  \n", "Apply the comments")).toBe("Apply the comments");
    expect(appendComposerPromptDraft("My note", "Apply the comments")).toBe(
      "My note\nApply the comments",
    );
    expect(appendComposerPromptDraft("My note\n\n", "Apply")).toBe("My note\nApply");
  });

  it("leaves the draft alone when there is no text", () => {
    expect(appendComposerPromptDraft("My note", "")).toBe("My note");
    expect(appendComposerPromptDraft("", "")).toBe("");
  });
});

describe("resolveComposerPromptSendRoute", () => {
  it("sends straight away only from an idle chat", () => {
    expect(resolveComposerPromptSendRoute(idle)).toBe("send");
  });

  it("queues behind a live turn, a send in flight or earlier queued turns", () => {
    expect(resolveComposerPromptSendRoute({ ...idle, hasLiveTurn: true })).toBe("queue");
    expect(resolveComposerPromptSendRoute({ ...idle, isSendBusy: true })).toBe("queue");
    expect(resolveComposerPromptSendRoute({ ...idle, isConnecting: true })).toBe("queue");
    expect(resolveComposerPromptSendRoute({ ...idle, queuedTurnCount: 2 })).toBe("queue");
  });

  it("never answers a pending question or approval", () => {
    expect(
      resolveComposerPromptSendRoute({ ...idle, hasPendingUserInput: true, hasLiveTurn: true }),
    ).toBe("awaiting-input");
    expect(resolveComposerPromptSendRoute({ ...idle, hasPendingApproval: true })).toBe(
      "awaiting-input",
    );
  });

  it("reports a provider that cannot send", () => {
    expect(resolveComposerPromptSendRoute({ ...idle, providerUsable: false })).toBe("no-provider");
  });
});

describe("buildComposerPromptTurn", () => {
  it("is a text-only chat turn with the composer's dispatch settings", () => {
    const settings: TurnDispatchSettings = {
      modelSelection: { provider: "codex", model: "gpt-5.5" },
      providerOptions: undefined,
      enableComputerControl: false,
      computerControlMode: "off",
      computerControlGeneration: 0,
      assistantDeliveryMode: "streaming",
      runtimeMode: "approval-required",
      interactionMode: "default",
      envMode: "local",
    };
    const turn = buildComposerPromptTurn({
      text: " Apply the comments ",
      settings,
      selectedProvider: "codex",
      selectedModel: "gpt-5.5",
      selectedPromptEffort: "high",
    });
    expect(turn).toMatchObject({
      kind: "chat",
      prompt: " Apply the comments ",
      previewText: "Apply the comments",
      images: [],
      files: [],
      skills: [],
      mentions: [],
      selectedProvider: "codex",
      selectedModel: "gpt-5.5",
      selectedPromptEffort: "high",
      modelSelection: settings.modelSelection,
      runtimeMode: "approval-required",
      interactionMode: "default",
      envMode: "local",
    });
    expect(turn.id).toBeTruthy();
  });
});

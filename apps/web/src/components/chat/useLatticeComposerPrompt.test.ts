import { ProjectId, ThreadId } from "@synara/contracts";
import { describe, expect, it, vi } from "vitest";

import { useComposerDraftStore } from "../../composerDraftStore";
import type { LatticeComposerPromptRequest } from "../../embedMode";
import type { TurnDispatchSettings } from "../ChatView.logic";
import {
  respondToLatticeComposerPrompt,
  type LatticeComposerPromptOptions,
} from "./useLatticeComposerPrompt";

const THREAD_ID = ThreadId.makeUnsafe("thread-active");
const NEW_THREAD_ID = ThreadId.makeUnsafe("thread-new");
const PROJECT_ID = ProjectId.makeUnsafe("project-1");

const settings: TurnDispatchSettings = {
  modelSelection: { provider: "codex", model: "gpt-5.5" },
  providerOptions: undefined,
  enableComputerControl: false,
  computerControlMode: "off",
  computerControlGeneration: 0,
  assistantDeliveryMode: "streaming",
  runtimeMode: "full-access",
  interactionMode: "default",
  envMode: "local",
};

function request(overrides: Partial<LatticeComposerPromptRequest> = {}) {
  return {
    requestId: "req-1",
    workspaceRoot: "/Users/me/paper",
    text: "Apply the slide comments",
    mode: "send",
    thread: "active",
    ...overrides,
  } satisfies LatticeComposerPromptRequest;
}

function harness(overrides: Partial<LatticeComposerPromptOptions> = {}) {
  let composer = "";
  const options: LatticeComposerPromptOptions = {
    enabled: true,
    threadId: THREAD_ID,
    projectId: PROJECT_ID,
    hasPendingApproval: false,
    hasPendingUserInput: false,
    hasLiveTurn: false,
    isSendBusy: false,
    isConnecting: false,
    queuedTurnCount: 0,
    turnDispatchSettings: settings,
    selectedProvider: "codex",
    selectedModel: "gpt-5.5",
    selectedPromptEffort: null,
    readComposerPrompt: () => composer,
    setComposerPromptAndFocus: vi.fn((prompt: string) => {
      composer = prompt;
    }),
    isProviderUsable: vi.fn(async () => true),
    enqueueQueuedTurn: vi.fn(),
    sendQueuedTurn: vi.fn(async () => true),
    createThread: vi.fn(async () => NEW_THREAD_ID),
    ...overrides,
  };
  return {
    options,
    get composer() {
      return composer;
    },
    set composer(value: string) {
      composer = value;
    },
  };
}

describe("respondToLatticeComposerPrompt in the active chat", () => {
  it("drafts into an empty composer and focuses it without sending", async () => {
    const h = harness();
    await expect(
      respondToLatticeComposerPrompt(request({ mode: "draft" }), h.options),
    ).resolves.toEqual({ ok: true, outcome: "drafted", threadId: THREAD_ID });
    expect(h.composer).toBe("Apply the slide comments");
    expect(h.options.sendQueuedTurn).not.toHaveBeenCalled();
    expect(h.options.enqueueQueuedTurn).not.toHaveBeenCalled();
  });

  it("appends a draft below what the user already typed", async () => {
    const h = harness();
    h.composer = "My own note";
    await respondToLatticeComposerPrompt(request({ mode: "draft" }), h.options);
    expect(h.composer).toBe("My own note\nApply the slide comments");
  });

  it("only focuses the composer for an empty draft", async () => {
    const h = harness();
    h.composer = "My own note";
    await expect(
      respondToLatticeComposerPrompt(request({ mode: "draft", text: "" }), h.options),
    ).resolves.toMatchObject({ ok: true, outcome: "drafted" });
    expect(h.options.setComposerPromptAndFocus).toHaveBeenCalledWith("My own note");
  });

  it("sends through the composer's Send without touching the user's draft", async () => {
    const h = harness();
    h.composer = "Unsent draft";
    await expect(respondToLatticeComposerPrompt(request(), h.options)).resolves.toEqual({
      ok: true,
      outcome: "sent",
      threadId: THREAD_ID,
    });
    expect(h.options.sendQueuedTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "chat",
        prompt: "Apply the slide comments",
        modelSelection: settings.modelSelection,
        runtimeMode: "full-access",
      }),
    );
    expect(h.options.setComposerPromptAndFocus).not.toHaveBeenCalled();
    expect(h.composer).toBe("Unsent draft");
  });

  it("queues behind a live turn", async () => {
    const h = harness({ hasLiveTurn: true });
    await expect(respondToLatticeComposerPrompt(request(), h.options)).resolves.toEqual({
      ok: true,
      outcome: "queued",
      threadId: THREAD_ID,
    });
    expect(h.options.enqueueQueuedTurn).toHaveBeenCalledWith(
      THREAD_ID,
      expect.objectContaining({ prompt: "Apply the slide comments" }),
    );
    expect(h.options.sendQueuedTurn).not.toHaveBeenCalled();
  });

  it("drafts instead of answering a pending question or approval", async () => {
    for (const pending of [{ hasPendingUserInput: true }, { hasPendingApproval: true }]) {
      const h = harness({ ...pending, hasLiveTurn: true });
      await expect(respondToLatticeComposerPrompt(request(), h.options)).resolves.toMatchObject({
        ok: false,
        outcome: "drafted",
        threadId: THREAD_ID,
        error: { code: "awaiting-input" },
      });
      expect(h.composer).toBe("Apply the slide comments");
      expect(h.options.sendQueuedTurn).not.toHaveBeenCalled();
      expect(h.options.enqueueQueuedTurn).not.toHaveBeenCalled();
    }
  });

  it("drafts and reports no-provider when the provider cannot send", async () => {
    const h = harness({ isProviderUsable: vi.fn(async () => false) });
    await expect(respondToLatticeComposerPrompt(request(), h.options)).resolves.toMatchObject({
      ok: false,
      outcome: "drafted",
      error: { code: "no-provider" },
    });
    expect(h.composer).toBe("Apply the slide comments");
    expect(h.options.sendQueuedTurn).not.toHaveBeenCalled();
  });

  it("keeps the prompt as a draft when the send fails", async () => {
    const h = harness({ sendQueuedTurn: vi.fn(async () => false) });
    await expect(respondToLatticeComposerPrompt(request(), h.options)).resolves.toMatchObject({
      ok: false,
      outcome: "drafted",
      error: { code: "send-failed" },
    });
    expect(h.composer).toBe("Apply the slide comments");
  });

  it("reports a thrown send as send-failed", async () => {
    const h = harness({
      sendQueuedTurn: vi.fn(async () => {
        throw new Error("socket closed");
      }),
    });
    await expect(respondToLatticeComposerPrompt(request(), h.options)).resolves.toEqual({
      ok: false,
      error: { code: "send-failed", message: "socket closed" },
    });
  });
});

describe("respondToLatticeComposerPrompt in a new chat", () => {
  it("drafts into a fresh chat with the panel's model and access mode", async () => {
    const h = harness();
    h.composer = "Unsent draft";
    await expect(
      respondToLatticeComposerPrompt(request({ mode: "draft", thread: "new" }), h.options),
    ).resolves.toEqual({ ok: true, outcome: "drafted", threadId: NEW_THREAD_ID });
    expect(h.options.createThread).toHaveBeenCalledWith(PROJECT_ID, {
      fresh: true,
      entryPoint: "chat",
    });
    const draft = useComposerDraftStore.getState().draftsByThreadId[NEW_THREAD_ID];
    expect(draft?.prompt).toBe("Apply the slide comments");
    expect(draft?.runtimeMode).toBe("full-access");
    expect(h.composer).toBe("Unsent draft");
  });

  it("hands a send to the new chat's first-send queue", async () => {
    const h = harness();
    await expect(
      respondToLatticeComposerPrompt(request({ thread: "new" }), h.options),
    ).resolves.toEqual({ ok: true, outcome: "sent", threadId: NEW_THREAD_ID });
    const queued = useComposerDraftStore.getState().draftsByThreadId[NEW_THREAD_ID]?.queuedTurns;
    expect(queued?.at(-1)).toMatchObject({ kind: "chat", prompt: "Apply the slide comments" });
    expect(h.options.sendQueuedTurn).not.toHaveBeenCalled();
  });

  it("fails cleanly when no chat can be opened", async () => {
    const h = harness({ createThread: vi.fn(async () => null) });
    await expect(
      respondToLatticeComposerPrompt(request({ thread: "new" }), h.options),
    ).resolves.toMatchObject({ ok: false, error: { code: "send-failed" } });
  });
});

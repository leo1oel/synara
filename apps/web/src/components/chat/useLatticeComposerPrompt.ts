// FILE: useLatticeComposerPrompt.ts
// Purpose: Answers Lattice's `lattice:composer-prompt` requests, which prefill
// or send a prompt in the embedded panel's composer (Open Slide's in-canvas
// agent buttons route through here), with one `synara:composer-prompt-result`.
// Layer: Chat composer embed integration

import type { ProjectId, ThreadId } from "@synara/contracts";
import { useEffect } from "react";

import { useComposerDraftStore, type QueuedComposerChatTurn } from "../../composerDraftStore";
import { requestComposerFocus } from "../../composerFocusRequestStore";
import {
  postComposerPromptResultToLattice,
  readEmbedMode,
  readLatticeComposerPromptMessage,
  type LatticeComposerPromptRequest,
  type SynaraComposerPromptResult,
} from "../../embedMode";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  appendComposerPromptDraft,
  buildComposerPromptTurn,
  resolveComposerPromptSendRoute,
} from "../../lib/latticeComposerPrompt";
import type { NewThreadOptions } from "../../lib/threadBootstrap";
import type { TurnDispatchSettings } from "../ChatView.logic";

type PromptResult = Omit<SynaraComposerPromptResult, "type" | "version" | "requestId">;

export interface LatticeComposerPromptOptions {
  /** Only the panel's primary, focused chat answers; side and inactive panes stay quiet. */
  enabled: boolean;
  threadId: ThreadId;
  projectId: ProjectId | null;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  hasLiveTurn: boolean;
  isSendBusy: boolean;
  isConnecting: boolean;
  queuedTurnCount: number;
  turnDispatchSettings: TurnDispatchSettings;
  selectedProvider: QueuedComposerChatTurn["selectedProvider"];
  selectedModel: string | null;
  selectedPromptEffort: string | null;
  /** The live composer text, read from the editor rather than the last render. */
  readComposerPrompt: () => string;
  /** Replace the composer text and focus it. */
  setComposerPromptAndFocus: (prompt: string) => void;
  isProviderUsable: () => Promise<boolean>;
  enqueueQueuedTurn: (threadId: ThreadId, turn: QueuedComposerChatTurn) => void;
  /** The composer's own Send, given the turn to dispatch in place of the live draft. */
  sendQueuedTurn: (turn: QueuedComposerChatTurn) => Promise<boolean>;
  createThread: (projectId: ProjectId, options: NewThreadOptions) => Promise<ThreadId | null>;
}

async function handleActiveThread(
  request: LatticeComposerPromptRequest,
  opts: LatticeComposerPromptOptions,
): Promise<PromptResult> {
  const threadId = opts.threadId;
  const draft = () => {
    opts.setComposerPromptAndFocus(
      appendComposerPromptDraft(opts.readComposerPrompt(), request.text),
    );
  };
  if (request.mode === "draft") {
    draft();
    return { ok: true, outcome: "drafted", threadId };
  }
  const route = resolveComposerPromptSendRoute({
    hasPendingApproval: opts.hasPendingApproval,
    hasPendingUserInput: opts.hasPendingUserInput,
    providerUsable:
      opts.hasPendingApproval || opts.hasPendingUserInput || (await opts.isProviderUsable()),
    hasLiveTurn: opts.hasLiveTurn,
    isSendBusy: opts.isSendBusy,
    isConnecting: opts.isConnecting,
    queuedTurnCount: opts.queuedTurnCount,
  });
  // Whenever Lattice's prompt cannot go out, it stays in the composer for the
  // user instead of being lost.
  if (route === "awaiting-input") {
    draft();
    return {
      ok: false,
      outcome: "drafted",
      threadId,
      error: {
        code: "awaiting-input",
        message: "The chat is waiting for an answer or approval; the prompt was drafted.",
      },
    };
  }
  if (route === "no-provider") {
    draft();
    return {
      ok: false,
      outcome: "drafted",
      threadId,
      error: {
        code: "no-provider",
        message: "The selected provider is not ready; the prompt was drafted.",
      },
    };
  }
  const turn = buildComposerPromptTurn({
    text: request.text,
    settings: opts.turnDispatchSettings,
    selectedProvider: opts.selectedProvider,
    selectedModel: opts.selectedModel,
    selectedPromptEffort: opts.selectedPromptEffort,
  });
  if (route === "queue") {
    opts.enqueueQueuedTurn(threadId, turn);
    return { ok: true, outcome: "queued", threadId };
  }
  if (await opts.sendQueuedTurn(turn)) {
    return { ok: true, outcome: "sent", threadId };
  }
  draft();
  return {
    ok: false,
    outcome: "drafted",
    threadId,
    error: { code: "send-failed", message: "The prompt could not be sent; it was drafted." },
  };
}

async function handleNewThread(
  request: LatticeComposerPromptRequest,
  opts: LatticeComposerPromptOptions,
): Promise<PromptResult> {
  if (!opts.projectId) {
    return {
      ok: false,
      error: { code: "send-failed", message: "No project is open in this panel." },
    };
  }
  const providerUsable = request.mode === "draft" || (await opts.isProviderUsable());
  const threadId = await opts.createThread(opts.projectId, { fresh: true, entryPoint: "chat" });
  if (!threadId) {
    return { ok: false, error: { code: "send-failed", message: "Could not open a new chat." } };
  }
  const drafts = useComposerDraftStore.getState();
  drafts.setModelSelection(threadId, opts.turnDispatchSettings.modelSelection);
  drafts.setRuntimeMode(threadId, opts.turnDispatchSettings.runtimeMode);
  if (request.mode === "draft" || !providerUsable) {
    if (request.text) drafts.setPrompt(threadId, request.text);
    requestComposerFocus(threadId);
    return providerUsable
      ? { ok: true, outcome: "drafted", threadId }
      : {
          ok: false,
          outcome: "drafted",
          threadId,
          error: {
            code: "no-provider",
            message: "The selected provider is not ready; the prompt was drafted.",
          },
        };
  }
  const turn = buildComposerPromptTurn({
    text: request.text,
    settings: {
      ...opts.turnDispatchSettings,
      // The new chat runs in the environment it was created with.
      envMode: drafts.getDraftThread(threadId)?.envMode ?? opts.turnDispatchSettings.envMode,
    },
    selectedProvider: opts.selectedProvider,
    selectedModel: opts.selectedModel,
    selectedPromptEffort: opts.selectedPromptEffort,
  });
  // The new chat's view drains this through its regular first-send path, as
  // "New chat" from a transcript selection does.
  drafts.enqueueQueuedTurn(threadId, turn);
  return { ok: true, outcome: "sent", threadId };
}

/** Carry out one valid request; never throws, so Lattice always gets an answer. */
export async function respondToLatticeComposerPrompt(
  request: LatticeComposerPromptRequest,
  options: LatticeComposerPromptOptions,
): Promise<PromptResult> {
  try {
    return request.thread === "new"
      ? await handleNewThread(request, options)
      : await handleActiveThread(request, options);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "send-failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function useLatticeComposerPrompt(options: LatticeComposerPromptOptions): void {
  // Answer with this render's state: the chat may switch threads while a send runs.
  const handleRequest = useStableCallback((request: LatticeComposerPromptRequest) =>
    respondToLatticeComposerPrompt(request, options),
  );

  const enabled = options.enabled;
  useEffect(() => {
    if (!enabled) return;
    const config = readEmbedMode();
    if (!config?.hostOrigin) return;
    const receive = (event: MessageEvent) => {
      const message = readLatticeComposerPromptMessage(event, config);
      if (!message) return;
      if (message.kind === "rejected") {
        postComposerPromptResultToLattice(config, {
          requestId: message.requestId,
          ok: false,
          error: { code: message.code, message: message.message },
        });
        return;
      }
      const { requestId } = message.request;
      // Answer even if this view unmounts mid-send: Lattice holds the request open.
      void handleRequest(message.request).then((result) => {
        postComposerPromptResultToLattice(config, { requestId, ...result });
      });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [enabled, handleRequest]);
}

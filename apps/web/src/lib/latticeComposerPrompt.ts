// FILE: latticeComposerPrompt.ts
// Purpose: Decide what a Lattice `lattice:composer-prompt` request does to the
// composer, and build the queued turn its send rides on.
// Layer: Web embed integration logic

import type { QueuedComposerChatTurn } from "../composerDraftDomain";
import {
  queuedChatTurnDispatchFields,
  type TurnDispatchSettings,
} from "../components/ChatView.logic";
import { randomUUID } from "./utils";

/**
 * Put Lattice's text into the composer: an empty composer takes it as is, a
 * draft keeps what the user typed and gains it on a new line, and no text
 * leaves the draft alone (the request only focuses the composer).
 */
export function appendComposerPromptDraft(current: string, text: string): string {
  if (text.length === 0) return current;
  if (current.trim().length === 0) return text;
  return `${current.replace(/\n+$/, "")}\n${text}`;
}

export type ComposerPromptSendRoute = "awaiting-input" | "no-provider" | "queue" | "send";

/**
 * Where a send request goes. A pending question or approval is never answered
 * by Lattice; anything that would block or reorder a direct send (a live turn,
 * a send or session start in flight, earlier queued turns) queues it behind the
 * work already there.
 */
export function resolveComposerPromptSendRoute(input: {
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  providerUsable: boolean;
  hasLiveTurn: boolean;
  isSendBusy: boolean;
  isConnecting: boolean;
  queuedTurnCount: number;
}): ComposerPromptSendRoute {
  if (input.hasPendingApproval || input.hasPendingUserInput) return "awaiting-input";
  if (!input.providerUsable) return "no-provider";
  if (input.hasLiveTurn || input.isSendBusy || input.isConnecting || input.queuedTurnCount > 0) {
    return "queue";
  }
  return "send";
}

/**
 * A text-only chat turn carrying the composer's current provider, model,
 * effort and dispatch settings. Sending it as a queued turn leaves the user's
 * own draft untouched, and the send path appends the Lattice host context when
 * it is dispatched.
 */
export function buildComposerPromptTurn(input: {
  text: string;
  settings: TurnDispatchSettings;
  selectedProvider: QueuedComposerChatTurn["selectedProvider"];
  selectedModel: string | null;
  selectedPromptEffort: string | null;
}): QueuedComposerChatTurn {
  return {
    id: randomUUID(),
    kind: "chat",
    createdAt: new Date().toISOString(),
    previewText: input.text.trim(),
    prompt: input.text,
    images: [],
    files: [],
    assistantSelections: [],
    browserAnnotations: [],
    terminalContexts: [],
    fileComments: [],
    pastedTexts: [],
    pullRequestContexts: [],
    skills: [],
    mentions: [],
    selectedProvider: input.selectedProvider,
    selectedModel: input.selectedModel,
    selectedPromptEffort: input.selectedPromptEffort,
    ...queuedChatTurnDispatchFields(input.settings, undefined),
  };
}

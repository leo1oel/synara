import {
  postHostContextSelectionClearToLattice,
  postHostContextRequestToLattice,
  readLatticeHostContextMessage,
  readLatticeHostContextRefreshFailedMessage,
  readEmbedMode,
  type LatticeHostContextSnapshot,
} from "../embedMode";
import { randomUUID } from "./utils";
import { workspaceRootsEqual } from "@synara/shared/threadWorkspace";

export const TRAILING_LATTICE_HOST_CONTEXT_BLOCK_PATTERN =
  /\n*(<lattice_active_context version="1">\n[\s\S]*?\n<\/lattice_active_context>)\s*$/u;

let liveLatticeHostContext: LatticeHostContextSnapshot | null = null;
const liveLatticeHostContextListeners = new Set<() => void>();

export function getLiveLatticeHostContext(): LatticeHostContextSnapshot | null {
  return liveLatticeHostContext;
}

export function setLiveLatticeHostContext(context: LatticeHostContextSnapshot | null): void {
  if (Object.is(liveLatticeHostContext, context)) return;
  liveLatticeHostContext = context;
  for (const listener of liveLatticeHostContextListeners) listener();
}

export function subscribeLiveLatticeHostContext(listener: () => void): () => void {
  liveLatticeHostContextListeners.add(listener);
  return () => liveLatticeHostContextListeners.delete(listener);
}

export function clearLatticeContextSelection(
  context: LatticeHostContextSnapshot,
): LatticeHostContextSnapshot {
  const withoutSelection = <T extends { selection?: string; selectionLines?: unknown }>(
    value: T,
  ): T => {
    const clone = { ...value };
    delete clone.selection;
    delete clone.selectionLines;
    return clone;
  };
  return {
    ...context,
    ...(context.editor ? { editor: withoutSelection(context.editor) } : {}),
    ...(context.pdf ? { pdf: withoutSelection(context.pdf) } : {}),
    ...(context.paper ? { paper: withoutSelection(context.paper) } : {}),
    ...(context.presentation ? { presentation: { ...context.presentation, selection: null } } : {}),
  };
}

// A successful dispatch must not clear a newer selection made during the RPC.
export function consumeDispatchedLatticeHostSelection(prompt: string): void {
  const context = getLiveLatticeHostContext();
  if (!context || !promptContainsLiveLatticeHostSelection(prompt, context)) return;
  setLiveLatticeHostContext(clearLatticeContextSelection(context));
  const config = readEmbedMode();
  if (config?.hostOrigin) postHostContextSelectionClearToLattice(config);
}

export interface ExtractedLatticeHostContext {
  promptText: string;
  context: LatticeHostContextSnapshot | null;
}

interface LatticeHostContextSelection {
  source: "editor" | "pdf" | "paper" | "presentation";
  text: string;
}

function latticeHostContextSelection(
  context: LatticeHostContextSnapshot | null,
): LatticeHostContextSelection | null {
  if (!context) return null;
  if (context.presentation?.selection) {
    const selection = context.presentation.selection;
    return {
      source: "presentation",
      text: `${selection.line}:${selection.column}:${selection.tagName}:${selection.text}`,
    };
  }
  const activeSelection =
    context.activeSurface === "editor"
      ? context.editor?.selection
      : context.activeSurface === "pdf"
        ? context.pdf?.selection
        : context.paper?.selection;
  if (activeSelection) {
    return { source: context.activeSurface, text: activeSelection };
  }
  if (context.editor?.selection) {
    return { source: "editor", text: context.editor.selection };
  }
  if (context.pdf?.selection) {
    return { source: "pdf", text: context.pdf.selection };
  }
  if (context.paper?.selection) {
    return { source: "paper", text: context.paper.selection };
  }
  return null;
}

export function extractTrailingLatticeHostContext(prompt: string): ExtractedLatticeHostContext {
  const match = TRAILING_LATTICE_HOST_CONTEXT_BLOCK_PATTERN.exec(prompt);
  if (!match) return { promptText: prompt, context: null };
  const promptText = prompt.slice(0, match.index).replace(/\n+$/u, "");
  const rawBlock = match[1] ?? "";
  const json = rawBlock
    .replace(/^<lattice_active_context version="1">\n/u, "")
    .replace(/\n<\/lattice_active_context>$/u, "");
  try {
    return {
      promptText,
      context: JSON.parse(json) as LatticeHostContextSnapshot,
    };
  } catch {
    return { promptText, context: null };
  }
}

export function promptContainsLiveLatticeHostSelection(
  prompt: string,
  liveContext: LatticeHostContextSnapshot | null,
): boolean {
  const sentSelection = latticeHostContextSelection(
    extractTrailingLatticeHostContext(prompt).context,
  );
  const liveSelection = latticeHostContextSelection(liveContext);
  return Boolean(
    sentSelection &&
    liveSelection &&
    sentSelection.source === liveSelection.source &&
    sentSelection.text === liveSelection.text,
  );
}

export function appendLatticeHostContextToPrompt(
  prompt: string,
  context: LatticeHostContextSnapshot | null,
): string {
  const visiblePrompt = extractTrailingLatticeHostContext(prompt).promptText.trim();
  if (!context) return visiblePrompt;
  const block = [
    '<lattice_active_context version="1">',
    JSON.stringify(context),
    "</lattice_active_context>",
  ].join("\n");
  return visiblePrompt ? `${visiblePrompt}\n\n${block}` : block;
}

/**
 * How long a send waits for Lattice's comment refresh. Lattice answers a local
 * project in tens of milliseconds, but an Overleaf-linked one first makes two
 * Overleaf REST calls (0.3-1.4 s, more on a bad network), and that wait sat in
 * front of every send. Past this cap the send uses the cached context: Lattice
 * pushes it with its locally cached comments, a late reply still refreshes
 * that cache for the next message, and the agent can call
 * `read_editor_comments` whenever it needs the live list.
 */
export const LATTICE_HOST_CONTEXT_SEND_WAIT_MS = 300;
// How long a late refresh may still update the cache after the send went out.
const LATE_REFRESH_WINDOW_MS = 15_000;

function cachedContextForSend(workspaceRoot: string): LatticeHostContextSnapshot | null {
  const latest = getLiveLatticeHostContext();
  if (!latest || !workspaceRootsEqual(latest.workspaceRoot, workspaceRoot)) return null;
  if (latest.editorComments) return latest;
  return {
    ...latest,
    editorComments: {
      workspaceRoot,
      capturedAt: latest.capturedAt ?? "unknown",
      comments: [],
      omittedCount: 0,
      overleaf: { status: "unavailable", error: "Comment refresh timed out." },
    },
  };
}

/** Refresh comments at dispatch time, waiting at most `waitMs` before sending the cached context. */
export async function refreshLatticeHostContextForSend(
  waitMs = LATTICE_HOST_CONTEXT_SEND_WAIT_MS,
): Promise<LatticeHostContextSnapshot | null> {
  const current = getLiveLatticeHostContext();
  const config = readEmbedMode();
  if (!config?.hostOrigin || window.parent === window) return current;
  const requestId = randomUUID();
  return new Promise((resolve) => {
    let sent = false;
    const send = (context: LatticeHostContextSnapshot | null) => {
      if (sent) return;
      sent = true;
      clearTimeout(sendTimer);
      resolve(context);
    };
    const stopListening = () => {
      clearTimeout(lateTimer);
      window.removeEventListener("message", onMessage);
    };
    const onMessage = (event: MessageEvent) => {
      if (readLatticeHostContextRefreshFailedMessage(event, config) === requestId) {
        stopListening();
        send(cachedContextForSend(config.workspaceRoot));
        return;
      }
      const context = readLatticeHostContextMessage(event, config);
      if (!context || context.requestId !== requestId) return;
      stopListening();
      if (!sent) {
        setLiveLatticeHostContext(context);
        send(context);
        return;
      }
      // The send already went out with the cache. Keep the newer editor state
      // Lattice pushed meanwhile and take only the refreshed comments.
      const live = getLiveLatticeHostContext();
      if (live && workspaceRootsEqual(live.workspaceRoot, context.workspaceRoot)) {
        setLiveLatticeHostContext(
          context.editorComments ? { ...live, editorComments: context.editorComments } : live,
        );
      }
    };
    const sendTimer = window.setTimeout(
      () => send(cachedContextForSend(config.workspaceRoot)),
      waitMs,
    );
    const lateTimer = window.setTimeout(stopListening, Math.max(waitMs, LATE_REFRESH_WINDOW_MS));
    window.addEventListener("message", onMessage);
    postHostContextRequestToLattice(config, { requestId, refreshComments: true });
  });
}

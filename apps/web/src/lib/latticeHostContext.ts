import {
  postHostContextSelectionClearToLattice,
  postHostContextRequestToLattice,
  readLatticeHostContextMessage,
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
  const withoutSelection = <T extends { selection?: string }>(value: T): T => {
    const clone = { ...value };
    delete clone.selection;
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

/** Refresh comments at dispatch time without ever blocking the user's send indefinitely. */
export async function refreshLatticeHostContextForSend(
  timeoutMs = 5_000,
): Promise<LatticeHostContextSnapshot | null> {
  const current = getLiveLatticeHostContext();
  const config = readEmbedMode();
  if (!config?.hostOrigin || window.parent === window) return current;
  const requestId = randomUUID();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (context: LatticeHostContextSnapshot | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(context);
    };
    const onMessage = (event: MessageEvent) => {
      const context = readLatticeHostContextMessage(event, config);
      if (!context || context.requestId !== requestId) return;
      setLiveLatticeHostContext(context);
      finish(context);
    };
    const timer = window.setTimeout(() => {
      const latest = getLiveLatticeHostContext();
      if (!latest || !workspaceRootsEqual(latest.workspaceRoot, config.workspaceRoot)) {
        return finish(null);
      }
      finish({
        ...latest,
        editorComments: {
          workspaceRoot: config.workspaceRoot,
          capturedAt: latest.editorComments?.capturedAt ?? latest.capturedAt ?? "unknown",
          comments: latest.editorComments?.comments ?? [],
          omittedCount: latest.editorComments?.omittedCount ?? 0,
          overleaf: { status: "unavailable", error: "Comment refresh timed out." },
        },
      });
    }, timeoutMs);
    window.addEventListener("message", onMessage);
    postHostContextRequestToLattice(config, { requestId, refreshComments: true });
  });
}

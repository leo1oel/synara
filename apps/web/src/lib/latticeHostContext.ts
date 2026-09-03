import type { LatticeHostContextSnapshot } from "../embedMode";

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

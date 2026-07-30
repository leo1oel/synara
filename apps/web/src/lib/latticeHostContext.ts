import type { LatticeHostContextSnapshot } from "../embedMode";

export const TRAILING_LATTICE_HOST_CONTEXT_BLOCK_PATTERN =
  /\n*(<lattice_active_context version="1">\n[\s\S]*?\n<\/lattice_active_context>)\s*$/u;

export interface ExtractedLatticeHostContext {
  promptText: string;
  context: LatticeHostContextSnapshot | null;
}

export function extractTrailingLatticeHostContext(
  prompt: string,
): ExtractedLatticeHostContext {
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

// FILE: codexFollowUps.ts
// Purpose: Lift Codex follow-up directives out of assistant text so the
//          transcript renders them as suggestion chips, not raw syntax.
// Layer: Web chat presentation logic
// Exports: splitCodexFollowUps, CodexFollowUp

/** One `:codex-followup[label]{prompt="..."}` suggestion. */
export interface CodexFollowUp {
  label: string;
  prompt: string;
}

export interface CodexFollowUpSplit {
  /** The reply's markdown with every directive line removed. */
  text: string;
  followUps: readonly CodexFollowUp[];
}

const DIRECTIVE_NAME = ":codex-followup";
// A whole line holding one directive (up to three spaces of indentation, as
// markdown allows before a paragraph). The label ends at the first `]{`, so a
// label may itself contain brackets.
const DIRECTIVE_LINE_PATTERN = /^ {0,3}:codex-followup\[(.*?)\]\{(.*)\}\s*$/;
// `prompt="..."` with backslash escapes, or single-quoted.
const PROMPT_ATTRIBUTE_PATTERN = /(?:^|\s)prompt=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/;
const OPENING_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})\s*$/;

function unescapeAttribute(value: string): string {
  return value.replace(/\\(.)/g, (_, char: string) =>
    char === "n" ? "\n" : char === "t" ? "\t" : char,
  );
}

/**
 * A directive line's suggestion: null when the line is not a directive, and
 * `undefined` for a directive with nothing to suggest, which is still hidden.
 * A directive without a prompt suggests its label.
 */
function parseDirectiveLine(line: string): CodexFollowUp | null | undefined {
  const match = DIRECTIVE_LINE_PATTERN.exec(line);
  if (!match) return null;
  const label = (match[1] ?? "").trim();
  const attribute = PROMPT_ATTRIBUTE_PATTERN.exec(match[2] ?? "");
  const rawPrompt = attribute?.[1] ?? attribute?.[2];
  const prompt = rawPrompt === undefined ? label : unescapeAttribute(rawPrompt).trim();
  if (!prompt) return undefined;
  return { label: label || prompt, prompt };
}

/**
 * While a reply streams, its last line may be a directive that is still
 * arriving. Hide it as soon as it can only be one, so the raw syntax never
 * flashes before the line completes and parses.
 */
function isPartialDirectiveLine(line: string): boolean {
  const trimmed = line.trimStart();
  if (!trimmed || line.length - trimmed.length > 3) return false;
  return trimmed.startsWith(DIRECTIVE_NAME) || DIRECTIVE_NAME.startsWith(trimmed);
}

/**
 * Codex ends a reply with suggested next prompts, one directive per line:
 * `:codex-followup[Polish the talk]{prompt="Make the talk read naturally"}`.
 * Directive lines outside fenced code are removed from the text and returned
 * in order; inside a fence they stay literal. With `streaming`, an unfinished
 * directive on the last line is held back as well.
 */
export function splitCodexFollowUps(text: string, streaming = false): CodexFollowUpSplit {
  const lastLine = text.slice(text.lastIndexOf("\n") + 1);
  if (!text.includes(DIRECTIVE_NAME) && !(streaming && isPartialDirectiveLine(lastLine))) {
    return { text, followUps: [] };
  }
  const lines = text.split("\n");
  const kept: string[] = [];
  const followUps: CodexFollowUp[] = [];
  let fence: string | null = null;
  lines.forEach((line, index) => {
    if (fence !== null) {
      // A fence closes on a bare run of its own character at least as long.
      const closing = CLOSING_FENCE_PATTERN.exec(line)?.[1];
      if (closing && closing[0] === fence[0] && closing.length >= fence.length) fence = null;
      kept.push(line);
      return;
    }
    const opening = OPENING_FENCE_PATTERN.exec(line)?.[1];
    if (opening) {
      fence = opening;
      kept.push(line);
      return;
    }
    const followUp = parseDirectiveLine(line);
    if (followUp !== null) {
      if (followUp) followUps.push(followUp);
      return;
    }
    if (streaming && index === lines.length - 1 && isPartialDirectiveLine(line)) return;
    kept.push(line);
  });
  if (kept.length === lines.length) return { text, followUps: [] };
  // Directives usually trail the reply after a blank line; drop the blank
  // lines they leave behind so the body ends where the prose does.
  return { text: kept.join("\n").trimEnd(), followUps };
}

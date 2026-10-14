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
  /** The reply's markdown with every directive removed. */
  text: string;
  followUps: readonly CodexFollowUp[];
}

const DIRECTIVE_NAME = ":codex-followup";
// One directive anywhere on a line. The label ends at the first `]{`, so a
// label may itself contain brackets; the attribute block ends at the first `}`
// outside a quoted value, so a prompt may contain braces.
const DIRECTIVE_PATTERN =
  /:codex-followup\[(.*?)\]\{((?:[^}"']|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*)\}/g;
// `prompt="..."` with backslash escapes, or single-quoted.
const PROMPT_ATTRIBUTE_PATTERN = /(?:^|\s)prompt=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/;
const OPENING_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})\s*$/;
// What a line that held only directives leaves behind: indentation, a bullet
// or ordered-list marker, a quote marker, separators between directives.
const LEFTOVER_PATTERN = /^[\s>]*(?:[-*+]|\d{1,9}[.)])?[\s,;|·、，；]*$/;

function unescapeAttribute(value: string): string {
  return value.replace(/\\(.)/g, (_, char: string) =>
    char === "n" ? "\n" : char === "t" ? "\t" : char,
  );
}

/**
 * A directive's suggestion, or `undefined` for one with nothing to suggest,
 * which is still hidden. A directive without a prompt suggests its label.
 */
function toFollowUp(rawLabel: string, attributes: string): CodexFollowUp | undefined {
  const label = rawLabel.trim();
  const attribute = PROMPT_ATTRIBUTE_PATTERN.exec(attributes);
  const rawPrompt = attribute?.[1] ?? attribute?.[2];
  const prompt = rawPrompt === undefined ? label : unescapeAttribute(rawPrompt).trim();
  if (!prompt) return undefined;
  return { label: label || prompt, prompt };
}

/**
 * Remove the directives in one line of prose, outside its inline code spans.
 * Returns the line without them (null when they were all it held) and adds
 * their suggestions, in order.
 */
function liftLineDirectives(line: string, followUps: CodexFollowUp[]): string | null {
  if (!line.includes(DIRECTIVE_NAME)) return line;
  // Split on backtick runs. A run opens a code span only when the same run
  // closes it later on the line; text inside a span stays literal.
  const parts = line.split(/(`+)/);
  let found = false;
  for (let index = 0; index < parts.length; index += 2) {
    parts[index] = parts[index]!.replace(
      DIRECTIVE_PATTERN,
      (_, label: string, attributes: string) => {
        found = true;
        const followUp = toFollowUp(label, attributes);
        if (followUp) followUps.push(followUp);
        return "";
      },
    );
    const run = parts[index + 1];
    if (run === undefined) break;
    const close = parts.indexOf(run, index + 3);
    if (close !== -1 && close % 2 === 1) index = close - 1;
  }
  if (!found) return line;
  const rest = parts.join("").replace(/[ \t]+$/, "");
  return LEFTOVER_PATTERN.test(rest) ? null : rest;
}

/**
 * While a reply streams, its tail may be a directive that is still arriving.
 * Where to cut the last line so the raw syntax never flashes before it
 * completes and parses: at a directive that has not closed yet (complete ones
 * are already gone), or at a bare prefix of the name after a space, bullet or
 * line start. -1 keeps the line whole.
 */
function partialDirectiveStart(line: string): number {
  const open = line.lastIndexOf(DIRECTIVE_NAME);
  if (open !== -1) return open;
  const prefix = /(?:^|\s)(:[a-z-]{1,14})$/.exec(line);
  return prefix && DIRECTIVE_NAME.startsWith(prefix[1]!) ? line.length - prefix[1]!.length : -1;
}

type ScannedLine = { kind: "content" | "blank" | "removed"; text: string };

/**
 * Join the scanned lines back up. A run of blank lines that a removed
 * directive line sat in collapses to one break (none at the end), so a lifted
 * list or trailing block leaves no gap; other blank lines and fenced code keep
 * their exact shape.
 */
function joinScannedLines(lines: readonly ScannedLine[]): string {
  const out: string[] = [];
  let gap: ScannedLine[] = [];
  const flushGap = (atEnd: boolean) => {
    const removed = gap.some((line) => line.kind === "removed");
    const blanks = gap.filter((line) => line.kind === "blank").map((line) => line.text);
    if (!removed) out.push(...blanks);
    else if (!atEnd && out.length > 0 && blanks.length > 0) out.push("");
    gap = [];
  };
  for (const line of lines) {
    if (line.kind === "content") {
      flushGap(false);
      out.push(line.text);
    } else {
      gap.push(line);
    }
  }
  flushGap(true);
  return out.join("\n").trimEnd();
}

/**
 * Codex ends a reply with suggested next prompts written as directives:
 * `:codex-followup[Polish the talk]{prompt="Make the talk read naturally"}`.
 * It puts them on lines of their own, as list items, or inline after other
 * text. Every directive outside fenced code and inline code is removed from
 * the text and returned in order; a list item or line that held only
 * directives goes with them, so no empty bullet is left. The reply's last
 * line also loses an unfinished directive or a bare list marker while it
 * streams, and once directives were found: a reply cut off mid-stream (a
 * steer interrupts it) keeps the half-written tail it had.
 */
export function splitCodexFollowUps(text: string, streaming = false): CodexFollowUpSplit {
  const lastLine = text.slice(text.lastIndexOf("\n") + 1);
  if (!text.includes(DIRECTIVE_NAME) && !(streaming && partialDirectiveStart(lastLine) !== -1)) {
    return { text, followUps: [] };
  }
  const lines = text.split("\n");
  let tailIndex = lines.length - 1;
  while (tailIndex > 0 && !lines[tailIndex]!.trim()) tailIndex -= 1;
  const scanned: ScannedLine[] = [];
  const followUps: CodexFollowUp[] = [];
  let changed = false;
  let fence: string | null = null;
  lines.forEach((line, index) => {
    if (fence !== null) {
      // A fence closes on a bare run of its own character at least as long.
      const closing = CLOSING_FENCE_PATTERN.exec(line)?.[1];
      if (closing && closing[0] === fence[0] && closing.length >= fence.length) fence = null;
      scanned.push({ kind: "content", text: line });
      return;
    }
    const opening = OPENING_FENCE_PATTERN.exec(line)?.[1];
    if (opening) {
      fence = opening;
      scanned.push({ kind: "content", text: line });
      return;
    }
    let rest = liftLineDirectives(line, followUps);
    if (rest !== null && index === tailIndex && (streaming || followUps.length > 0)) {
      const cut = partialDirectiveStart(rest);
      const head = (cut === -1 ? rest : rest.slice(0, cut)).replace(/[ \t]+$/, "");
      if (head !== rest) rest = head;
      if (rest.trim() && LEFTOVER_PATTERN.test(rest)) rest = null;
    }
    if (rest !== line) changed = true;
    if (rest === null) scanned.push({ kind: "removed", text: line });
    else scanned.push({ kind: rest.trim() ? "content" : "blank", text: rest });
  });
  if (!changed) return { text, followUps: [] };
  return { text: joinScannedLines(scanned), followUps };
}

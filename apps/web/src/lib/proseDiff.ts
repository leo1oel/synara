// FILE: proseDiff.ts
// Purpose: Read a unified patch as prose: each changed line of a paper becomes one sentence with
//          its deleted and inserted words marked, the way a red-pen proof reads, instead of a
//          code diff's minus and plus rows. Lattice's Changes view and pull request redline use it.
// Layer: Pure diff presentation helpers
// Exports: splitPatchByFile, readProseChanges, wordDiff, isProsePath

/** One run of a changed sentence: kept words, words taken out, or words put in. */
export interface ProseSegment {
  kind: "same" | "del" | "ins";
  text: string;
}

/** A changed line, numbered by where it now sits in the file (or sat, for a deletion). */
export interface ProseChange {
  line: number;
  segments: ProseSegment[];
  /** The nearest LaTeX section title above the change, when the patch shows one. */
  section: string | null;
}

/** Files whose lines are sentences: LaTeX, Markdown and plain text. */
export function isProsePath(path: string): boolean {
  return /\.(tex|ltx|md|markdown|txt|rst|org)$/i.test(path);
}

/** A multi-file patch cut into one patch per file, keyed by the file's new path. */
export function splitPatchByFile(patch: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith("diff --git ")) continue;
    const path =
      /^\+\+\+ b\/(.+)$/m.exec(chunk)?.[1] ??
      /^--- a\/(.+)$/m.exec(chunk)?.[1] ??
      /^diff --git a\/.+ b\/(.+)$/m.exec(chunk)?.[1];
    if (path) files.set(path.trim(), chunk);
  }
  return files;
}

const SECTION_PATTERN = /\\(?:sub)*section\*?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/;
const ABSTRACT_PATTERN = /\\begin\{abstract\}/;

function sectionTitleOf(text: string): string | null {
  const section = SECTION_PATTERN.exec(text);
  if (section?.[1]) return section[1].trim();
  if (ABSTRACT_PATTERN.test(text)) return "Abstract";
  return null;
}

// Words, runs of spaces, LaTeX commands and single punctuation marks, so a changed word is
// marked alone and `\cite{x}` never splits mid-command.
const TOKEN_PATTERN = /\\[A-Za-z@]+\*?|\s+|[\p{L}\p{N}_'’-]+|[^\s]/gu;

function tokenize(text: string): string[] {
  return text.match(TOKEN_PATTERN) ?? [];
}

/** Past this many token pairs a line is shown as replaced whole rather than diffed word by word. */
const MAX_WORD_DIFF_CELLS = 250_000;

function pushSegment(segments: ProseSegment[], kind: ProseSegment["kind"], text: string) {
  if (!text) return;
  const last = segments.at(-1);
  if (last?.kind === kind) last.text += text;
  else segments.push({ kind, text });
}

/**
 * The words of `before` and `after` as kept, deleted and inserted runs. A lone space kept
 * between two changes joins them, so a rewording reads as one replaced phrase.
 */
export function wordDiff(before: string, after: string): ProseSegment[] {
  const a = tokenize(before);
  const b = tokenize(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const segments: ProseSegment[] = [];
  pushSegment(segments, "same", a.slice(0, start).join(""));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > MAX_WORD_DIFF_CELLS) {
    pushSegment(segments, "del", midA.join(""));
    pushSegment(segments, "ins", midB.join(""));
  } else {
    // Longest common subsequence over tokens, filled from the end so the walk runs forwards.
    const width = midB.length + 1;
    const table = new Uint32Array((midA.length + 1) * width);
    for (let i = midA.length - 1; i >= 0; i -= 1) {
      for (let j = midB.length - 1; j >= 0; j -= 1) {
        table[i * width + j] =
          midA[i] === midB[j]
            ? table[(i + 1) * width + j + 1]! + 1
            : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
      }
    }
    const raw: ProseSegment[] = [];
    let i = 0;
    let j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
        pushSegment(raw, "same", midA[i]!);
        i += 1;
        j += 1;
      } else if (
        j < midB.length &&
        (i >= midA.length || table[i * width + j + 1]! >= table[(i + 1) * width + j]!)
      ) {
        pushSegment(raw, "ins", midB[j]!);
        j += 1;
      } else {
        pushSegment(raw, "del", midA[i]!);
        i += 1;
      }
    }
    // Fold a kept single space between changes into both sides of the change.
    for (let index = 0; index < raw.length; index += 1) {
      const segment = raw[index]!;
      const previous = raw[index - 1];
      const next = raw[index + 1];
      if (
        segment.kind === "same" &&
        /^[^\S\n]+$/.test(segment.text) &&
        previous &&
        previous.kind !== "same" &&
        next &&
        next.kind !== "same"
      ) {
        pushSegment(segments, "del", segment.text);
        pushSegment(segments, "ins", segment.text);
      } else {
        pushSegment(segments, segment.kind, segment.text);
      }
    }
  }
  pushSegment(segments, "same", a.slice(endA).join(""));
  return deletionsFirst(segments);
}

/** Each run of changes as its whole deletion followed by its whole insertion. */
function deletionsFirst(segments: ProseSegment[]): ProseSegment[] {
  const result: ProseSegment[] = [];
  let deleted = "";
  let inserted = "";
  const flushChange = () => {
    pushSegment(result, "del", deleted);
    pushSegment(result, "ins", inserted);
    deleted = "";
    inserted = "";
  };
  for (const segment of segments) {
    if (segment.kind === "del") deleted += segment.text;
    else if (segment.kind === "ins") inserted += segment.text;
    else {
      flushChange();
      pushSegment(result, "same", segment.text);
    }
  }
  flushChange();
  return result;
}

/**
 * A file's patch as changed sentences. Within each block of removed then added lines, the
 * n-th removed line pairs with the n-th added line; a line without a partner is wholly
 * deleted or inserted. Blank-only lines are skipped.
 */
export function readProseChanges(
  filePatch: string,
  options?: { maxChanges?: number },
): {
  changes: ProseChange[];
  truncated: boolean;
} {
  const maxChanges = options?.maxChanges ?? 200;
  const changes: ProseChange[] = [];
  let truncated = false;
  let oldLine = 0;
  let newLine = 0;
  let section: string | null = null;
  let removed: Array<{ line: number; text: string }> = [];
  let added: Array<{ line: number; text: string }> = [];

  const flush = () => {
    const pairs = Math.max(removed.length, added.length);
    for (let index = 0; index < pairs; index += 1) {
      const before = removed[index];
      const after = added[index];
      const beforeText = before?.text ?? "";
      const afterText = after?.text ?? "";
      if (!beforeText.trim() && !afterText.trim()) continue;
      if (changes.length >= maxChanges) {
        truncated = true;
        break;
      }
      const segments: ProseSegment[] =
        before && after
          ? wordDiff(beforeText, afterText)
          : before
            ? [{ kind: "del", text: beforeText }]
            : [{ kind: "ins", text: afterText }];
      // A changed heading is its own section's first change.
      section = sectionTitleOf(afterText || beforeText) ?? section;
      changes.push({ line: after?.line ?? before?.line ?? newLine, segments, section });
    }
    removed = [];
    added = [];
  };

  for (const rawLine of filePatch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(rawLine);
    if (hunk) {
      flush();
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      // Git puts the nearest heading-like line after the range when it finds one.
      section = sectionTitleOf(hunk[3] ?? "") ?? section;
      continue;
    }
    if (rawLine.startsWith("+++ ") || rawLine.startsWith("--- ")) continue;
    if (rawLine.startsWith("-")) {
      if (added.length > 0) flush();
      removed.push({ line: oldLine, text: rawLine.slice(1) });
      oldLine += 1;
    } else if (rawLine.startsWith("+")) {
      added.push({ line: newLine, text: rawLine.slice(1) });
      newLine += 1;
    } else if (rawLine.startsWith(" ")) {
      flush();
      section = sectionTitleOf(rawLine.slice(1)) ?? section;
      oldLine += 1;
      newLine += 1;
    } else if (rawLine.startsWith("\\")) {
      continue;
    } else {
      flush();
    }
    if (truncated) break;
  }
  flush();
  return { changes, truncated };
}

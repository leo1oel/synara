// FILE: gitPatchPaths.ts
// Purpose: Name the file a `diff --git` section belongs to, undoing Git's path quoting.
// Layer: Diff parsing helper (pure)
//
// Git C-quotes a patch path when it holds a double quote, a backslash, a control character or,
// under the default `core.quotePath`, any non-ASCII byte: `+++ "b/\344\270\255\346\226\207.tex"`.
// An unquoted path is literal, so a backslash is an escape only inside quotes. Patch paths are
// for matching a section to a file Git listed; operations use the listed (raw) path.

const NAMED_ESCAPES: Readonly<Record<string, number>> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  "\\": 0x5c,
};

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

/** The quoted path opening at `start`, decoded as UTF-8, and the index after its closing quote. */
function readQuotedPath(text: string, start: number): { path: string; end: number } | null {
  const bytes: number[] = [];
  let index = start + 1;
  while (index < text.length) {
    const char = text[index]!;
    if (char === '"') {
      return { path: utf8Decoder.decode(new Uint8Array(bytes)), end: index + 1 };
    }
    if (char === "\\") {
      const octal = /^[0-3][0-7]{2}/.exec(text.slice(index + 1, index + 4))?.[0];
      if (octal) {
        bytes.push(Number.parseInt(octal, 8));
        index += 4;
        continue;
      }
      const escaped = NAMED_ESCAPES[text[index + 1] ?? ""];
      if (escaped === undefined) return null;
      bytes.push(escaped);
      index += 2;
      continue;
    }
    // With core.quotePath=false, raw UTF-8 text can sit inside quotes next to escapes.
    const codePoint = text.codePointAt(index)!;
    const literal = String.fromCodePoint(codePoint);
    bytes.push(...utf8Encoder.encode(literal));
    index += literal.length;
  }
  return null;
}

function stripSidePrefix(path: string, prefix: "a/" | "b/"): string | null {
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/** A `---`/`+++` path, or null for `/dev/null`. */
function readMarkerPath(value: string, prefix: "a/" | "b/"): string | null {
  if (value.startsWith('"')) {
    const quoted = readQuotedPath(value, 0);
    return quoted ? stripSidePrefix(quoted.path, prefix) : null;
  }
  // Git ends a path containing a space with a tab here; any other trailing character,
  // including a space, belongs to the name.
  const path = value.endsWith("\t") ? value.slice(0, -1) : value;
  return path === "/dev/null" ? null : stripSidePrefix(path, prefix);
}

/** A `rename to` / `copy to` path, which carries no side prefix. */
function readBarePath(value: string): string | null {
  if (!value.startsWith('"')) return value.length > 0 ? value : null;
  return readQuotedPath(value, 0)?.path ?? null;
}

/** The new-side path of `diff --git <a> <b>`, which only a binary or mode-only section relies on. */
function readHeaderPath(value: string): string | null {
  if (value.startsWith('"')) {
    const source = readQuotedPath(value, 0);
    if (!source || value[source.end] !== " ") return null;
    const rest = value.slice(source.end + 1);
    return rest.startsWith('"')
      ? stripSidePrefix(readQuotedPath(rest, 0)?.path ?? "", "b/")
      : stripSidePrefix(rest, "b/");
  }
  const quotedTarget = value.indexOf(' "b/');
  if (quotedTarget >= 0) {
    return stripSidePrefix(readQuotedPath(value, quotedTarget + 1)?.path ?? "", "b/");
  }
  // Unquoted and unrenamed, the header is `a/<path> b/<path>`; spaces make any other split
  // ambiguous, and renames are named by `rename to` instead.
  const pathLength = (value.length - 5) / 2;
  if (!Number.isInteger(pathLength) || pathLength < 1) return null;
  const path = value.slice(2, 2 + pathLength);
  return value === `a/${path} b/${path}` ? path : null;
}

/**
 * The file one `diff --git` section changes: its new path, or its old path when deleted.
 * Only the section header is read, so changed lines that look like headers are never mistaken
 * for one.
 */
export function readPatchSectionPath(section: string): string | null {
  let headerPath: string | null = null;
  let renamedPath: string | null = null;
  let oldPath: string | null = null;
  for (const line of section.split("\n")) {
    if (line.startsWith("@@") || line.startsWith("Binary files ") || line === "GIT binary patch") {
      break;
    }
    if (line.startsWith("diff --git ")) {
      headerPath = readHeaderPath(line.slice("diff --git ".length));
    } else if (line.startsWith("rename to ")) {
      renamedPath = readBarePath(line.slice("rename to ".length));
    } else if (line.startsWith("copy to ")) {
      renamedPath = readBarePath(line.slice("copy to ".length));
    } else if (line.startsWith("--- ")) {
      oldPath = readMarkerPath(line.slice(4), "a/");
    } else if (line.startsWith("+++ ")) {
      const newPath = readMarkerPath(line.slice(4), "b/");
      if (newPath !== null) return newPath;
    }
  }
  return renamedPath ?? oldPath ?? headerPath;
}

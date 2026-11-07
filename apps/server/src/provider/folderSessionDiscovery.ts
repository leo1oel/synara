// FILE: folderSessionDiscovery.ts
// Purpose: List one folder's existing Claude Code and Codex sessions, read-only, straight
//          from each agent's own session store, so a chat started in another editor (VS
//          Code, a terminal) can be continued here.
// Layer: Provider metadata discovery
//
// Privacy is the constraint that shapes this file: only the requested folder's sessions
// are ever opened. Claude keeps one directory per project, so only that directory is
// listed. Codex keeps every session in one dated tree, so each rollout's first record
// (its session metadata) is read to learn its folder and nothing else of a non-matching
// session is read. Every session's recorded cwd must equal the folder exactly; a
// subfolder, a parent, or another folder that happens to encode to the same Claude
// directory name never matches. Nothing here writes to either store.

import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export interface FolderSession {
  readonly provider: "claudeAgent" | "codex";
  readonly externalId: string;
  /** Empty when neither a name nor the first prompt fits the bounded reads. */
  readonly title: string;
  readonly cwd: string;
  readonly updatedAt: string;
}

export interface FolderSessionDiscoveryInput {
  /**
   * The folder's spellings: as the project records it and its real path. Claude names
   * its project directory after the cwd it was started in, which may be either one.
   */
  readonly folders: ReadonlyArray<string>;
  readonly limit: number;
  /** Whether a recorded cwd is this folder; injected so it can canonicalize. */
  readonly sameFolder: (cwd: string) => Promise<boolean>;
}

const SESSION_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const CODEX_ROLLOUT = /^rollout-.+-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i;
// A session's head carries its cwd and first prompt; its tail carries a later /rename.
// Neither read grows with the transcript.
const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 64 * 1024;
// Bounds the Codex walk, which must open rollouts from every folder to find this one's.
const MAX_CODEX_ROLLOUTS_SCANNED = 2_000;
const MAX_CODEX_INDEX_BYTES = 8 * 1024 * 1024;
const TITLE_MAX_CHARS = 120;

type Row = Record<string, unknown>;

function object(value: unknown): Row | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isMissing(error: unknown): boolean {
  const code = object(error)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function directoryEntries(directory: string) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

async function readRange(file: string, start: number, end: number): Promise<string> {
  if (end <= start) return "";
  const chunks: string[] = [];
  const stream = createReadStream(file, { encoding: "utf8", start, end: end - 1 });
  try {
    for await (const chunk of stream) chunks.push(chunk as string);
  } catch (error) {
    // A session can be deleted between listing and reading.
    if (!isMissing(error)) throw error;
  } finally {
    stream.destroy();
  }
  return chunks.join("");
}

/** Complete JSON lines of a bounded read; the cut-off first or last line is dropped. */
function jsonLines(chunk: string, options: { dropFirst: boolean; dropLast: boolean }): Row[] {
  const lines = chunk.split("\n");
  if (options.dropFirst) lines.shift();
  if (options.dropLast) lines.pop();
  return lines.flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const entry = object(JSON.parse(line));
      return entry ? [entry] : [];
    } catch {
      return [];
    }
  });
}

function oneLine(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > TITLE_MAX_CHARS
    ? `${collapsed.slice(0, TITLE_MAX_CHARS - 1)}…`
    : collapsed;
}

// Harness-injected turns (slash-command echoes, caveats, IDE context) start with a tag.
function promptText(content: unknown): string | undefined {
  const value =
    text(content) ??
    (Array.isArray(content)
      ? content
          .map((part) => (object(part)?.type === "text" ? text(object(part)?.text) : undefined))
          .find((part) => part !== undefined)
      : undefined);
  return value && !value.startsWith("<") ? value : undefined;
}

// ── Claude Code ──────────────────────────────────────────────────────────────

/** Claude Code names a project's directory by its cwd with every non-alphanumeric as "-". */
export function claudeProjectDirectoryName(folder: string): string {
  return folder.replace(/[^a-zA-Z0-9]/g, "-");
}

// Claude shortens very long names with a hash suffix we do not reproduce, so a long
// folder also matches directories that share the shortened prefix; the cwd check
// below still admits only this folder's sessions.
const CLAUDE_DIRECTORY_NAME_PREFIX = 200;

async function claudeProjectDirectories(configDir: string, folder: string): Promise<string[]> {
  const projectsDir = path.join(configDir, "projects");
  const name = claudeProjectDirectoryName(folder);
  if (name.length <= CLAUDE_DIRECTORY_NAME_PREFIX) return [path.join(projectsDir, name)];
  const prefix = name.slice(0, CLAUDE_DIRECTORY_NAME_PREFIX);
  return (await directoryEntries(projectsDir)).flatMap((entry) =>
    entry.isDirectory() && (entry.name === name || entry.name.startsWith(`${prefix}-`))
      ? [path.join(projectsDir, entry.name)]
      : [],
  );
}

interface ClaudeHead {
  readonly cwd?: string;
  readonly firstPrompt?: string;
  readonly title?: string;
}

function readClaudeTitle(entry: Row): string | undefined {
  if (entry.type === "custom-title") return text(entry.customTitle);
  if (entry.type === "summary") return text(entry.summary);
  return undefined;
}

async function readClaudeSession(file: string, size: number): Promise<ClaudeHead> {
  const head = jsonLines(await readRange(file, 0, Math.min(size, HEAD_BYTES)), {
    dropFirst: false,
    dropLast: size > HEAD_BYTES,
  });
  let cwd: string | undefined;
  let firstPrompt: string | undefined;
  let title: string | undefined;
  for (const entry of head) {
    title = readClaudeTitle(entry) ?? title;
    if (entry.isSidechain === true) continue;
    cwd ??= text(entry.cwd);
    if (!firstPrompt && entry.type === "user" && entry.isMeta !== true) {
      firstPrompt = promptText(object(entry.message)?.content);
    }
  }
  if (size > HEAD_BYTES) {
    const tailStart = Math.max(HEAD_BYTES, size - TAIL_BYTES);
    const tail = jsonLines(await readRange(file, tailStart, size), {
      dropFirst: true,
      dropLast: false,
    });
    for (const entry of tail) title = readClaudeTitle(entry) ?? title;
  }
  return {
    ...(cwd ? { cwd } : {}),
    ...(firstPrompt ? { firstPrompt } : {}),
    ...(title ? { title } : {}),
  };
}

export async function discoverClaudeFolderSessions(
  input: FolderSessionDiscoveryInput & { readonly configDir: string },
): Promise<FolderSession[]> {
  const files: { id: string; file: string; size: number; mtimeMs: number }[] = [];
  const directories = new Set(
    (
      await Promise.all(
        input.folders.map((folder) => claudeProjectDirectories(input.configDir, folder)),
      )
    ).flat(),
  );
  for (const directory of directories) {
    for (const entry of await directoryEntries(directory)) {
      // Subagent transcripts and tool output live in subdirectories. Never recurse.
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const id = entry.name.slice(0, -".jsonl".length);
      if (!SESSION_ID.test(id)) continue;
      const file = path.join(directory, entry.name);
      const info = await fs.stat(file).catch(() => null);
      if (info && info.size > 0) files.push({ id, file, size: info.size, mtimeMs: info.mtimeMs });
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const sessions: FolderSession[] = [];
  const seen = new Set<string>();
  for (const candidate of files) {
    if (sessions.length >= input.limit) break;
    if (seen.has(candidate.id)) continue;
    const head = await readClaudeSession(candidate.file, candidate.size);
    if (!head.cwd || !(await input.sameFolder(head.cwd))) continue;
    // A session with no real prompt (a warm-up, a title probe) has nothing to continue,
    // unless the prompt is past the head read: a long first message.
    if (!head.firstPrompt && candidate.size <= HEAD_BYTES) continue;
    seen.add(candidate.id);
    sessions.push({
      provider: "claudeAgent",
      externalId: candidate.id,
      title: oneLine(head.title ?? head.firstPrompt ?? ""),
      cwd: head.cwd,
      updatedAt: new Date(candidate.mtimeMs).toISOString(),
    });
  }
  return sessions;
}

// ── Codex ────────────────────────────────────────────────────────────────────

async function descendingDirectories(directory: string): Promise<string[]> {
  return (await directoryEntries(directory))
    .flatMap((entry) => (entry.isDirectory() ? [entry.name] : []))
    .toSorted((a, b) => b.localeCompare(a))
    .map((name) => path.join(directory, name));
}

/** Newest first: sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl. */
async function* codexRollouts(sessionsDir: string) {
  for (const year of await descendingDirectories(sessionsDir)) {
    for (const month of await descendingDirectories(year)) {
      for (const day of await descendingDirectories(month)) {
        const names = (await directoryEntries(day))
          .flatMap((entry) =>
            entry.isFile() && CODEX_ROLLOUT.test(entry.name) ? [entry.name] : [],
          )
          .toSorted((a, b) => b.localeCompare(a));
        for (const name of names) yield path.join(day, name);
      }
    }
  }
}

function isSubagentSource(source: unknown): boolean {
  if (typeof source === "string") return /^sub_?agent/i.test(source);
  return object(source)?.subagent !== undefined;
}

interface CodexMeta {
  readonly id: string;
  readonly cwd: string;
}

// The first record is the session's metadata. Its base instructions can make the line
// longer than the head read, so a cut-off line still yields its leading id and cwd.
function readCodexMeta(head: string): CodexMeta | undefined {
  const newline = head.indexOf("\n");
  const firstLine = newline === -1 ? head : head.slice(0, newline);
  const record = jsonLines(firstLine, { dropFirst: false, dropLast: false })[0];
  if (record) {
    if (record.type !== "session_meta") return undefined;
    const payload = object(record.payload);
    const id = text(payload?.id);
    const cwd = text(payload?.cwd);
    if (!id || !cwd || isSubagentSource(payload?.source)) return undefined;
    return { id, cwd };
  }
  if (newline !== -1 || !firstLine.includes('"type":"session_meta"')) return undefined;
  const field = (name: string) => {
    const match = new RegExp(`"${name}":("(?:[^"\\\\]|\\\\.)*")`).exec(firstLine);
    if (!match?.[1]) return undefined;
    try {
      return text(JSON.parse(match[1]));
    } catch {
      return undefined;
    }
  };
  if (/"source":\{"subagent"/.test(firstLine)) return undefined;
  const id = field("id");
  const cwd = field("cwd");
  return id && cwd ? { id, cwd } : undefined;
}

function codexFirstPrompt(head: string, size: number): string | undefined {
  const records = jsonLines(head, { dropFirst: false, dropLast: size > HEAD_BYTES });
  for (const record of records) {
    const payload = object(record.payload);
    if (record.type === "event_msg" && payload?.type === "user_message") {
      const message = promptText(payload.message);
      if (message) return message;
    }
  }
  for (const record of records) {
    const payload = object(record.payload);
    if (record.type === "response_item" && payload?.type === "message" && payload.role === "user") {
      const message = promptText(payload.content);
      if (message) return message;
    }
  }
  return undefined;
}

/** Thread names Codex keeps beside its sessions; the last entry per id wins. */
async function readCodexThreadNames(
  codexHome: string,
  ids: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.size === 0) return names;
  const file = path.join(codexHome, "session_index.jsonl");
  const info = await fs.stat(file).catch(() => null);
  if (!info) return names;
  const start = Math.max(0, info.size - MAX_CODEX_INDEX_BYTES);
  for (const entry of jsonLines(await readRange(file, start, info.size), {
    dropFirst: start > 0,
    dropLast: false,
  })) {
    const id = text(entry.id);
    const name = text(entry.thread_name);
    if (id && name && ids.has(id)) names.set(id, name);
  }
  return names;
}

export async function discoverCodexFolderSessions(
  input: FolderSessionDiscoveryInput & { readonly codexHome: string },
): Promise<FolderSession[]> {
  const matches: { meta: CodexMeta; prompt: string | undefined; mtimeMs: number }[] = [];
  const seen = new Set<string>();
  let scanned = 0;
  for await (const file of codexRollouts(path.join(input.codexHome, "sessions"))) {
    if (matches.length >= input.limit || scanned >= MAX_CODEX_ROLLOUTS_SCANNED) break;
    scanned += 1;
    const info = await fs.stat(file).catch(() => null);
    if (!info || info.size === 0) continue;
    const head = await readRange(file, 0, Math.min(info.size, HEAD_BYTES));
    const meta = readCodexMeta(head);
    if (!meta || seen.has(meta.id) || !(await input.sameFolder(meta.cwd))) continue;
    seen.add(meta.id);
    const prompt = codexFirstPrompt(head, info.size);
    // An empty session (opened, never sent) has nothing to continue; a prompt past the
    // head read (long base instructions) still counts.
    if (!prompt && info.size <= HEAD_BYTES) continue;
    matches.push({ meta, prompt, mtimeMs: info.mtimeMs });
  }
  const names = await readCodexThreadNames(
    input.codexHome,
    new Set(matches.map((match) => match.meta.id)),
  );
  return matches
    .toSorted((a, b) => b.mtimeMs - a.mtimeMs)
    .map((match) => ({
      provider: "codex" as const,
      externalId: match.meta.id,
      title: oneLine(names.get(match.meta.id) ?? match.prompt ?? ""),
      cwd: match.meta.cwd,
      updatedAt: new Date(match.mtimeMs).toISOString(),
    }));
}

import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  claudeProjectDirectoryName,
  discoverClaudeFolderSessions,
  discoverCodexFolderSessions,
} from "./folderSessionDiscovery";

let root: string;
let folder: string;
// Encodes to the same Claude directory name as `folder`: "…/paper-a" vs "…/paper/a".
let lookalike: string;
let other: string;

const jsonl = (rows: ReadonlyArray<unknown>) => rows.map((row) => JSON.stringify(row)).join("\n");
const sameFolder = async (cwd: string) => (await realpath(cwd).catch(() => cwd)) === folder;

async function writeAt(file: string, content: string, minutesAgo: number) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  const when = new Date(Date.now() - minutesAgo * 60_000);
  await utimes(file, when, when);
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "synara-folder-sessions-")));
  folder = path.join(root, "work", "paper-a");
  lookalike = path.join(root, "work", "paper", "a");
  other = path.join(root, "work", "thesis");
  for (const dir of [folder, lookalike, other]) await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("discoverClaudeFolderSessions", () => {
  const claudeSession = (cwd: string, prompt: string, extra: ReadonlyArray<unknown> = []) =>
    jsonl([
      {
        type: "user",
        cwd,
        isSidechain: false,
        entrypoint: "claude-vscode",
        message: { role: "user", content: prompt },
      },
      {
        type: "assistant",
        cwd,
        isSidechain: false,
        message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      },
      ...extra,
    ]);

  it("lists only sessions recorded for the folder, newest first, titled by rename or first prompt", async () => {
    const configDir = path.join(root, "home", ".claude");
    const projectDir = path.join(configDir, "projects", claudeProjectDirectoryName(folder));
    expect(claudeProjectDirectoryName(lookalike)).toBe(claudeProjectDirectoryName(folder));
    const vscode = randomUUID();
    const terminal = randomUUID();
    const renamed = randomUUID();
    const collision = randomUUID();
    const empty = randomUUID();
    await writeAt(
      path.join(projectDir, `${vscode}.jsonl`),
      claudeSession(folder, "Tighten the abstract"),
      30,
    );
    await writeAt(
      path.join(projectDir, `${terminal}.jsonl`),
      claudeSession(folder, "Fix the bibliography"),
      5,
    );
    await writeAt(
      path.join(projectDir, `${renamed}.jsonl`),
      claudeSession(folder, "first prompt", [
        { type: "custom-title", customTitle: "Related work pass" },
      ]),
      10,
    );
    // Same directory name, different folder: never listed.
    await writeAt(
      path.join(projectDir, `${collision}.jsonl`),
      claudeSession(lookalike, "Not this folder"),
      1,
    );
    // No real prompt: nothing to continue.
    await writeAt(
      path.join(projectDir, `${empty}.jsonl`),
      jsonl([
        {
          type: "user",
          cwd: folder,
          isMeta: true,
          message: { role: "user", content: "<command-name>/clear</command-name>" },
        },
      ]),
      2,
    );
    // Another project's directory, and a subagent transcript below a session: never read.
    await writeAt(
      path.join(configDir, "projects", claudeProjectDirectoryName(other), `${randomUUID()}.jsonl`),
      claudeSession(other, "Thesis chapter"),
      1,
    );
    await writeAt(
      path.join(projectDir, vscode, "subagents", `${randomUUID()}.jsonl`),
      claudeSession(folder, "sub"),
      1,
    );

    const sessions = await discoverClaudeFolderSessions({
      configDir,
      folders: [folder],
      sameFolder,
      limit: 10,
    });
    expect(sessions.map((session) => [session.externalId, session.title])).toEqual([
      [terminal, "Fix the bibliography"],
      [renamed, "Related work pass"],
      [vscode, "Tighten the abstract"],
    ]);
    expect(
      sessions.every((session) => session.provider === "claudeAgent" && session.cwd === folder),
    ).toBe(true);
  });

  it("honours the limit and finds nothing when the folder has no Claude directory", async () => {
    const configDir = path.join(root, "home", ".claude");
    const projectDir = path.join(configDir, "projects", claudeProjectDirectoryName(folder));
    for (let i = 0; i < 4; i += 1) {
      await writeAt(
        path.join(projectDir, `${randomUUID()}.jsonl`),
        claudeSession(folder, `Prompt ${i}`),
        i,
      );
    }
    expect(
      await discoverClaudeFolderSessions({ configDir, folders: [folder], sameFolder, limit: 2 }),
    ).toHaveLength(2);
    expect(
      await discoverClaudeFolderSessions({
        configDir,
        folders: [other],
        sameFolder: async (cwd) => cwd === other,
        limit: 10,
      }),
    ).toEqual([]);
  });
});

describe("discoverCodexFolderSessions", () => {
  const rollout = (input: {
    id: string;
    cwd: string;
    prompt?: string;
    source?: unknown;
    instructions?: string;
  }) =>
    jsonl([
      {
        timestamp: "2026-11-01T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: input.id,
          timestamp: "2026-11-01T10:00:00.000Z",
          cwd: input.cwd,
          originator: "codex_vscode",
          source: input.source ?? "vscode",
          ...(input.instructions ? { instructions: input.instructions } : {}),
        },
      },
      ...(input.prompt
        ? [
            {
              type: "response_item",
              payload: {
                type: "message",
                role: "user",
                content: [
                  { type: "input_text", text: "<environment_context>…</environment_context>" },
                ],
              },
            },
            { type: "event_msg", payload: { type: "user_message", message: input.prompt } },
          ]
        : []),
    ]);
  const file = (home: string, day: string, id: string) =>
    path.join(
      home,
      "sessions",
      ...day.split("/"),
      `rollout-${day.replaceAll("/", "-")}T10-00-00-${id}.jsonl`,
    );

  it("lists only the folder's rollouts, skipping subagents and empty sessions, titled by thread name", async () => {
    const codexHome = path.join(root, "home", ".codex");
    const named = randomUUID();
    const plain = randomUUID();
    const long = randomUUID();
    const subagent = randomUUID();
    const empty = randomUUID();
    const elsewhere = randomUUID();
    await writeAt(
      file(codexHome, "2026/10/30", named),
      rollout({ id: named, cwd: folder, prompt: "Draft the intro" }),
      60,
    );
    await writeAt(
      file(codexHome, "2026/11/01", plain),
      rollout({ id: plain, cwd: folder, prompt: "Check the proofs" }),
      3,
    );
    // Base instructions push the first record past the head read.
    await writeAt(
      file(codexHome, "2026/11/01", long),
      rollout({ id: long, cwd: folder, prompt: "Long head", instructions: "x".repeat(400 * 1024) }),
      20,
    );
    await writeAt(
      file(codexHome, "2026/11/01", subagent),
      rollout({ id: subagent, cwd: folder, prompt: "sub", source: { subagent: "review" } }),
      1,
    );
    await writeAt(file(codexHome, "2026/11/01", empty), rollout({ id: empty, cwd: folder }), 1);
    await writeAt(
      file(codexHome, "2026/11/01", elsewhere),
      rollout({ id: elsewhere, cwd: other, prompt: "Thesis" }),
      1,
    );
    await writeAt(
      path.join(codexHome, "session_index.jsonl"),
      jsonl([
        { id: named, thread_name: "Old name", updated_at: "2026-10-30T10:00:00Z" },
        { id: named, thread_name: "Introduction rewrite", updated_at: "2026-10-31T10:00:00Z" },
        { id: elsewhere, thread_name: "Thesis", updated_at: "2026-11-01T10:00:00Z" },
      ]),
      1,
    );

    const sessions = await discoverCodexFolderSessions({
      codexHome,
      folders: [folder],
      sameFolder,
      limit: 10,
    });
    // The long-head session is found by its id and cwd; its prompt is past the head read.
    expect(sessions.map((session) => [session.externalId, session.title])).toEqual([
      [plain, "Check the proofs"],
      [long, ""],
      [named, "Introduction rewrite"],
    ]);
    expect(
      sessions.every((session) => session.provider === "codex" && session.cwd === folder),
    ).toBe(true);
  });

  it("finds nothing without a sessions directory", async () => {
    expect(
      await discoverCodexFolderSessions({
        codexHome: path.join(root, "missing"),
        folders: [folder],
        sameFolder,
        limit: 10,
      }),
    ).toEqual([]);
  });
});

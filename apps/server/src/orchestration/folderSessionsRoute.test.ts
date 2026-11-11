import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_SERVER_SETTINGS,
  OrchestrationCommand,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@synara/contracts";
import { Effect, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectImportRepository } from "../persistence/projectImportRepository";
import type { FolderSession } from "../provider/folderSessionDiscovery";
import type { ServerSettingsShape } from "../serverSettings";
import { makeFolderSessionHandlers, type FolderSessionDiscoverInput } from "./folderSessionsRoute";
import { buildNativeSessionResumeCommand } from "./nativeSessionHandoff";
import { ProjectImportError } from "./projectImportHistory";
import type { makeImportThreadHandler } from "./importThreadRoute";
import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine";

type FolderSessionsRepository = Pick<ProjectImportRepository, "listNativeBindings">;

const PROJECT_ID = ProjectId.makeUnsafe("project-paper");
const UPDATED = "2026-11-01T10:00:00.000Z";

let root: string;
let folder: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "synara-folder-route-")));
  folder = path.join(root, "paper");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function harness(input: {
  sessions: ReadonlyArray<FolderSession>;
  bindings?: ReadonlyArray<{
    threadId: string;
    provider: string;
    cursor: string;
    providerInstanceId?: string;
  }>;
  /** Chats with no native binding yet, on the named agent. */
  unboundThreads?: ReadonlyArray<{ threadId: string; provider: string }>;
  importFails?: boolean;
  platform?: NodeJS.Platform;
}) {
  const chat = (threadId: string, provider: string) => ({
    id: ThreadId.makeUnsafe(threadId),
    projectId: PROJECT_ID,
    deletedAt: null as string | null,
    modelSelection: { provider, model: "test-model" },
    envMode: "local",
    worktreePath: null,
  });
  const threads: { id: ThreadId; projectId: ProjectId; deletedAt: string | null }[] = [
    ...(input.bindings ?? []).map((binding) => chat(binding.threadId, binding.provider)),
    ...(input.unboundThreads ?? []).map((thread) => chat(thread.threadId, thread.provider)),
  ];
  const projects = [
    {
      id: PROJECT_ID,
      workspaceRoot: folder,
      deletedAt: null,
      defaultModelSelection: null,
    },
  ];
  const commands: OrchestrationCommand[] = [];
  const discoveries: FolderSessionDiscoverInput[] = [];
  const engine = {
    getReadModel: () => Effect.succeed({ projects, threads } as unknown as OrchestrationReadModel),
    dispatch: (command: OrchestrationCommand) =>
      Effect.sync(() => {
        commands.push(command);
        if (command.type === "thread.create")
          threads.push({ id: command.threadId, projectId: command.projectId, deletedAt: null });
        if (command.type === "thread.delete") {
          const thread = threads.find((entry) => entry.id === command.threadId);
          if (thread) thread.deletedAt = UPDATED;
        }
        return { sequence: commands.length };
      }),
  } as unknown as OrchestrationEngineShape;
  const importThread = vi.fn(
    (body: { threadId: ThreadId; externalId: string }, options?: { continueInPlace?: boolean }) =>
      input.importFails
        ? Effect.fail(new ProjectImportError({ message: "resume failed" }))
        : Effect.succeed({ threadId: body.threadId, options }),
  );
  const handlers = makeFolderSessionHandlers({
    repository: {
      // The repository returns a SQL statement; any Effect of the rows stands in.
      listNativeBindings: (() =>
        Effect.succeed(
          (input.bindings ?? []).map((binding) => ({
            threadId: ThreadId.makeUnsafe(binding.threadId),
            projectId: PROJECT_ID,
            provider: binding.provider,
            providerInstanceId: binding.providerInstanceId ?? null,
            cursor: binding.cursor,
          })),
        )) as unknown as FolderSessionsRepository["listNativeBindings"],
    },
    orchestrationEngine: engine,
    serverSettings: {
      getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
    } as unknown as ServerSettingsShape,
    importThread: importThread as unknown as ReturnType<typeof makeImportThreadHandler>,
    homeDir: root,
    ...(input.platform ? { platform: input.platform } : {}),
    discover: async (discoverInput) => {
      discoveries.push(discoverInput);
      return input.sessions.filter((session) => session.provider === discoverInput.source.provider);
    },
  });
  return { handlers, commands, discoveries, importThread };
}

const claude = (id: string, minutesAgo = 0): FolderSession => ({
  provider: "claudeAgent",
  externalId: id,
  title: `Claude ${id}`,
  cwd: folder,
  updatedAt: new Date(Date.parse(UPDATED) - minutesAgo * 60_000).toISOString(),
});
const codex = (id: string, minutesAgo = 0): FolderSession => ({
  ...claude(id, minutesAgo),
  provider: "codex",
  title: `Codex ${id}`,
});

describe("folder sessions route", () => {
  it("lists both agents' sessions for the project folder only, newest first, minus open ones", async () => {
    const { handlers, discoveries } = harness({
      sessions: [claude("c-old", 30), claude("c-open", 1), codex("x-new", 0)],
      bindings: [
        {
          threadId: "thread-open",
          provider: "claudeAgent",
          cursor: JSON.stringify({ resume: "c-open" }),
        },
      ],
    });
    const result = await Effect.runPromise(handlers.listFolderSessions({ projectId: PROJECT_ID }));
    expect(result.sessions.map((session) => [session.provider, session.externalId])).toEqual([
      ["codex", "x-new"],
      ["claudeAgent", "c-old"],
    ]);
    expect(result.sessions[0]?.providerInstanceId).toBe(ProviderInstanceId.makeUnsafe("codex"));
    // Discovery is scoped to this project's folder, and only it is accepted as a cwd.
    expect(discoveries.map((entry) => entry.source.provider).toSorted()).toEqual([
      "claudeAgent",
      "codex",
    ]);
    for (const entry of discoveries) {
      expect(entry.folders).toEqual([folder]);
      expect(await entry.sameFolder(folder)).toBe(true);
      expect(await entry.sameFolder(path.join(folder, "sub"))).toBe(false);
      expect(await entry.sameFolder(root)).toBe(false);
    }
  });

  it("opens a session as a new chat of the project that resumes it in place", async () => {
    const { handlers, commands, importThread } = harness({ sessions: [codex("x-1")] });
    const { threadId } = await Effect.runPromise(
      handlers.openFolderSession({
        projectId: PROJECT_ID,
        provider: "codex",
        providerInstanceId: ProviderInstanceId.makeUnsafe("codex"),
        externalId: "x-1",
      }),
    );
    const create = commands.find((command) => command.type === "thread.create");
    expect(create).toMatchObject({
      threadId,
      projectId: PROJECT_ID,
      title: "Codex x-1",
      modelSelection: { provider: "codex" },
    });
    expect(importThread).toHaveBeenCalledWith(
      { threadId, externalId: "x-1" },
      { continueInPlace: true },
    );
  });

  it("gives an untitled session's chat a non-empty title", async () => {
    const { handlers, commands } = harness({ sessions: [{ ...codex("x-2"), title: "" }] });
    await Effect.runPromise(
      handlers.openFolderSession({
        projectId: PROJECT_ID,
        provider: "codex",
        providerInstanceId: ProviderInstanceId.makeUnsafe("codex"),
        externalId: "x-2",
      }),
    );
    const create = commands.find((command) => command.type === "thread.create");
    expect(create).toMatchObject({ title: "Codex session" });
    // The real command schema refuses an empty title.
    expect(Schema.decodeUnknownExit(OrchestrationCommand)(create)._tag).toBe("Success");
  });

  it("returns the chat that already continues the session instead of opening another", async () => {
    const { handlers, commands } = harness({
      sessions: [codex("x-1")],
      bindings: [
        { threadId: "thread-x", provider: "codex", cursor: JSON.stringify({ threadId: "x-1" }) },
      ],
    });
    const result = await Effect.runPromise(
      handlers.openFolderSession({
        projectId: PROJECT_ID,
        provider: "codex",
        providerInstanceId: ProviderInstanceId.makeUnsafe("codex"),
        externalId: "x-1",
      }),
    );
    expect(result.threadId).toBe("thread-x");
    expect(commands).toEqual([]);
  });

  it("refuses a session not found for this folder and removes a chat whose resume fails", async () => {
    const missing = harness({ sessions: [claude("c-1")] });
    await expect(
      Effect.runPromise(
        missing.handlers.openFolderSession({
          projectId: PROJECT_ID,
          provider: "claudeAgent",
          providerInstanceId: ProviderInstanceId.makeUnsafe("claudeAgent"),
          externalId: "c-from-another-folder",
        }),
      ),
    ).rejects.toThrow("no longer available for this folder");
    expect(missing.commands).toEqual([]);

    const failing = harness({ sessions: [claude("c-1")], importFails: true });
    await expect(
      Effect.runPromise(
        failing.handlers.openFolderSession({
          projectId: PROJECT_ID,
          provider: "claudeAgent",
          providerInstanceId: ProviderInstanceId.makeUnsafe("claudeAgent"),
          externalId: "c-1",
        }),
      ),
    ).rejects.toThrow("resume failed");
    expect(failing.commands.map((command) => command.type)).toEqual([
      "thread.create",
      "thread.delete",
    ]);
  });
});

describe("continue in terminal", () => {
  // A plain terminal reads ~/.claude and ~/.codex; the test home stands in for ~.
  beforeEach(() => {
    vi.stubEnv("HOME", root);
    vi.stubEnv("CLAUDE_CONFIG_DIR", undefined);
    vi.stubEnv("CODEX_HOME", undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const handoff = (h: ReturnType<typeof harness>, threadId: string) =>
    Effect.runPromise(
      h.handlers.getNativeSessionHandoff({ threadId: ThreadId.makeUnsafe(threadId) }),
    );

  it("copies codex resume with the chat's native Codex thread id", async () => {
    const h = harness({
      sessions: [],
      bindings: [
        {
          threadId: "chat-codex",
          provider: "codex",
          cursor: JSON.stringify({ threadId: "019a-x" }),
        },
      ],
      platform: "darwin",
    });
    expect(await handoff(h, "chat-codex")).toEqual({
      status: "available",
      provider: "codex",
      nativeId: "019a-x",
      cwd: folder,
      command: `cd '${folder}' && codex resume 019a-x`,
    });
  });

  it("copies claude --resume with the chat's Claude session id", async () => {
    const h = harness({
      sessions: [],
      bindings: [
        {
          threadId: "chat-claude",
          provider: "claudeAgent",
          cursor: JSON.stringify({ resume: "5f0c-claude" }),
        },
      ],
      platform: "darwin",
    });
    const result = await handoff(h, "chat-claude");
    expect(result).toMatchObject({ status: "available", provider: "claudeAgent" });
    expect(result.status === "available" && result.command).toBe(
      `cd '${folder}' && claude --resume 5f0c-claude`,
    );
  });

  it("names the account's config dir only when Claude ran outside ~/.claude", async () => {
    const configDir = path.join(root, "claude-work");
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const h = harness({
      sessions: [],
      bindings: [
        {
          threadId: "chat-claude",
          provider: "claudeAgent",
          cursor: JSON.stringify({ resume: "5f0c-claude" }),
        },
      ],
      platform: "darwin",
    });
    const result = await handoff(h, "chat-claude");
    expect(result.status === "available" && result.command).toBe(
      `cd '${folder}' && CLAUDE_CONFIG_DIR='${configDir}' claude --resume 5f0c-claude`,
    );
  });

  it("names CODEX_HOME only when Codex ran on a home other than ~/.codex", async () => {
    const codexHome = path.join(root, "codex-alt");
    const bindings = [
      { threadId: "chat-codex", provider: "codex", cursor: JSON.stringify({ threadId: "019a-x" }) },
    ];
    vi.stubEnv("CODEX_HOME", path.join(root, ".codex"));
    const atDefault = await handoff(
      harness({ sessions: [], bindings, platform: "darwin" }),
      "chat-codex",
    );
    expect(atDefault.status === "available" && atDefault.command).toBe(
      `cd '${folder}' && codex resume 019a-x`,
    );
    vi.stubEnv("CODEX_HOME", codexHome);
    const elsewhere = await handoff(
      harness({ sessions: [], bindings, platform: "darwin" }),
      "chat-codex",
    );
    expect(elsewhere.status === "available" && elsewhere.command).toBe(
      `cd '${folder}' && CODEX_HOME='${codexHome}' codex resume 019a-x`,
    );
  });

  it("is unavailable, with a reason, when the chat has no native session", async () => {
    const h = harness({
      sessions: [],
      bindings: [{ threadId: "chat-starting", provider: "codex", cursor: "null" }],
      unboundThreads: [
        { threadId: "chat-new", provider: "claudeAgent" },
        { threadId: "chat-cursor", provider: "cursor" },
      ],
    });
    expect(await handoff(h, "chat-starting")).toEqual({
      status: "unavailable",
      reason: "noNativeSession",
    });
    expect(await handoff(h, "chat-new")).toEqual({
      status: "unavailable",
      reason: "noNativeSession",
    });
    expect(await handoff(h, "chat-cursor")).toEqual({
      status: "unavailable",
      reason: "unsupportedProvider",
    });
    await expect(handoff(h, "chat-gone")).rejects.toThrow("no longer open");
  });

  it("quotes a folder with spaces and quotes for the host's shell", async () => {
    folder = path.join(root, "Dr O'Neil $HOME paper");
    const bindings = [
      { threadId: "chat-codex", provider: "codex", cursor: JSON.stringify({ threadId: "019a-x" }) },
    ];
    const posix = await handoff(
      harness({ sessions: [], bindings, platform: "linux" }),
      "chat-codex",
    );
    expect(posix.status === "available" && posix.command).toBe(
      `cd '${root}/Dr O'\\''Neil $HOME paper' && codex resume 019a-x`,
    );
    const powerShell = await handoff(
      harness({ sessions: [], bindings, platform: "win32" }),
      "chat-codex",
    );
    expect(powerShell.status === "available" && powerShell.command).toBe(
      `Set-Location -LiteralPath '${root}/Dr O''Neil $HOME paper' -ErrorAction Stop; codex resume 019a-x`,
    );
  });
});

describe("buildNativeSessionResumeCommand", () => {
  it("quotes an unexpected native id and the store override", () => {
    expect(
      buildNativeSessionResumeCommand({
        provider: "codex",
        nativeId: "id; rm -rf ~",
        cwd: "/papers/thesis",
        storeOverride: "/Users/me/codex alt",
        platform: "darwin",
      }),
    ).toBe(`cd '/papers/thesis' && CODEX_HOME='/Users/me/codex alt' codex resume 'id; rm -rf ~'`);
    expect(
      buildNativeSessionResumeCommand({
        provider: "claudeAgent",
        nativeId: "5f0c",
        cwd: "C:\\Papers\\thesis",
        storeOverride: "C:\\Users\\me\\.claude-work",
        platform: "win32",
      }),
    ).toBe(
      `Set-Location -LiteralPath 'C:\\Papers\\thesis' -ErrorAction Stop; $env:CLAUDE_CONFIG_DIR = 'C:\\Users\\me\\.claude-work'; claude --resume 5f0c`,
    );
  });
});

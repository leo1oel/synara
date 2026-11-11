// FILE: folderSessionsRoute.ts
// Purpose: Lattice's "sessions from other editors": list a project folder's existing
//          Claude Code and Codex sessions and continue one as a chat of that project.
// Layer: Server orchestration
//
// Listing is read-only discovery (provider/folderSessionDiscovery.ts). Opening creates a
// chat in the project and hands it to upstream's import path, which resumes the native
// session by id and shows its history; nothing is copied into the agents' own stores.

import { homedir } from "node:os";

import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  ThreadId,
  type FolderSession,
  type GetNativeSessionHandoffInput,
  type NativeSessionHandoff,
  type ListFolderSessionsInput,
  type ListFolderSessionsResult,
  type ModelSelection,
  type OpenFolderSessionInput,
  type OpenFolderSessionResult,
  type ProjectImportProvider,
  type ServerSettings,
} from "@synara/contracts";
import {
  deriveProviderInstances,
  resolveModelSelectionInstanceId,
} from "@synara/shared/providerInstances";
import { Effect } from "effect";

import type { ProjectImportRepository } from "../persistence/projectImportRepository";
import {
  discoverClaudeFolderSessions,
  discoverCodexFolderSessions,
  type FolderSession as DiscoveredFolderSession,
} from "../provider/folderSessionDiscovery";
import { resolveBaseCodexHomePath } from "../codexHomePaths";
import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils";
import { makeKeyedLock } from "../provider/keyedLock";
import type { ServerSettingsShape } from "../serverSettings";
import { makeProjectImportDestinations } from "./projectImportDestinations";
import { nativeImportId, ProjectImportError, projectImportPromise } from "./projectImportHistory";
import { canonicalImportPath, importPathIdentity } from "./projectImportPaths";
import { type ProjectImportSource, resolveProjectImportSources } from "./projectImportSources";
import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine";
import type { makeImportThreadHandler } from "./importThreadRoute";
import { buildNativeSessionResumeCommand, defaultNativeSessionStore } from "./nativeSessionHandoff";

/** Per provider; the panel's history menu lists at most this many. */
export const FOLDER_SESSIONS_LIMIT = 20;

const PROVIDERS: ReadonlyArray<ProjectImportProvider> = ["claudeAgent", "codex"];

const UNTITLED_SESSION_TITLE: Record<ProjectImportProvider, string> = {
  claudeAgent: "Claude Code session",
  codex: "Codex session",
};

export interface FolderSessionDiscoverInput {
  readonly source: ProjectImportSource;
  readonly folders: ReadonlyArray<string>;
  readonly sameFolder: (cwd: string) => Promise<boolean>;
  readonly limit: number;
}

interface FolderSessionsRouteOptions {
  readonly repository: Pick<ProjectImportRepository, "listNativeBindings">;
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly serverSettings: ServerSettingsShape;
  readonly importThread: ReturnType<typeof makeImportThreadHandler>;
  readonly homeDir?: string;
  readonly stateDir?: string;
  /** Shell flavour of the copied terminal command; defaults to this host's. */
  readonly platform?: NodeJS.Platform;
  /** Injected by tests; defaults to the agents' on-disk stores. */
  readonly discover?: (
    input: FolderSessionDiscoverInput,
  ) => Promise<ReadonlyArray<DiscoveredFolderSession>>;
}

function discoverFromStore(input: FolderSessionDiscoverInput) {
  const common = { folders: input.folders, sameFolder: input.sameFolder, limit: input.limit };
  if (input.source.provider === "claudeAgent") {
    return input.source.claudeConfigDir
      ? discoverClaudeFolderSessions({ ...common, configDir: input.source.claudeConfigDir })
      : Promise.resolve([]);
  }
  return discoverCodexFolderSessions({
    ...common,
    codexHome: resolveBaseCodexHomePath(input.source.environment, input.source.codexHomePath),
  });
}

/** Accounts Lattice could continue a session in; a disabled one has no runtime. */
function enabledSources(
  settings: ServerSettings,
  paths: { readonly homeDir?: string | undefined; readonly stateDir?: string | undefined },
) {
  const enabled = new Set(
    deriveProviderInstances(settings).flatMap((instance) =>
      instance.enabled ? [instance.instanceId] : [],
    ),
  );
  return resolveProjectImportSources(settings, PROVIDERS, paths).filter((source) =>
    enabled.has(source.instanceId),
  );
}

export function makeFolderSessionHandlers(options: FolderSessionsRouteOptions) {
  const discover = options.discover ?? discoverFromStore;
  const sourcePaths = { homeDir: options.homeDir, stateDir: options.stateDir };
  const opens = makeKeyedLock<string>();

  /** Native sessions some live chat already continues, keyed `provider:id`. */
  const readOpenSessions = Effect.fn(function* () {
    const model = yield* options.orchestrationEngine.getReadModel();
    const destinations = makeProjectImportDestinations(model);
    const open = new Map<string, ThreadId>();
    for (const binding of yield* options.repository.listNativeBindings()) {
      if (binding.provider !== "codex" && binding.provider !== "claudeAgent") continue;
      if (!destinations.findThread(binding.threadId)) continue;
      let cursor: unknown;
      try {
        cursor = JSON.parse(binding.cursor ?? "null");
      } catch {
        continue;
      }
      const externalId = nativeImportId(binding.provider, cursor);
      if (externalId) open.set(`${binding.provider}:${externalId}`, binding.threadId);
    }
    return open;
  });

  const findProject = Effect.fn(function* (projectId: ListFolderSessionsInput["projectId"]) {
    const model = yield* options.orchestrationEngine.getReadModel();
    const project = model.projects.find(
      (entry) => entry.id === projectId && entry.deletedAt === null,
    );
    if (!project)
      return yield* new ProjectImportError({ message: "This project is no longer open." });
    return project;
  });

  /** Every enabled account's sessions for exactly this project's folder, newest first. */
  const discoverProjectSessions = Effect.fn(function* (
    projectId: ListFolderSessionsInput["projectId"],
  ) {
    const project = yield* findProject(projectId);
    const settings = yield* options.serverSettings.getSettings;
    const folder = yield* projectImportPromise(() => canonicalImportPath(project.workspaceRoot));
    const identity = importPathIdentity(folder);
    const sameFolder = async (cwd: string) =>
      importPathIdentity(await canonicalImportPath(cwd)) === identity;
    const folders = [...new Set([project.workspaceRoot, folder])];
    const found = yield* Effect.forEach(
      enabledSources(settings, sourcePaths),
      (source) =>
        projectImportPromise(async () => {
          try {
            const sessions = await discover({
              source,
              folders,
              sameFolder,
              limit: FOLDER_SESSIONS_LIMIT,
            });
            return sessions.map((session) => ({ session, source }));
          } catch {
            // One unreadable store must not hide the other agent's sessions.
            return [];
          }
        }),
      { concurrency: 2 },
    );
    // Accounts sharing one store list a session once, under the default account.
    const unique = new Map<string, (typeof found)[number][number]>();
    for (const entry of found.flat()) {
      const key = `${entry.session.provider}:${entry.session.externalId}`;
      if (!unique.has(key)) unique.set(key, entry);
    }
    return [...unique.values()].toSorted((a, b) =>
      b.session.updatedAt.localeCompare(a.session.updatedAt),
    );
  });

  const listFolderSessions = Effect.fn(function* (input: ListFolderSessionsInput) {
    const sessions = yield* discoverProjectSessions(input.projectId);
    const open = yield* readOpenSessions();
    return {
      sessions: sessions
        .filter(({ session }) => !open.has(`${session.provider}:${session.externalId}`))
        .map(
          ({ session, source }): FolderSession => ({
            provider: session.provider,
            providerInstanceId: source.instanceId,
            externalId: session.externalId,
            title: session.title,
            updatedAt: session.updatedAt,
          }),
        ),
    } satisfies ListFolderSessionsResult;
  });

  const openFolderSession = (input: OpenFolderSessionInput) =>
    opens.withLock(
      `${input.provider}:${input.externalId}`,
      Effect.gen(function* () {
        // A second click, or another window, lands in the chat the first one made.
        const existing = (yield* readOpenSessions()).get(`${input.provider}:${input.externalId}`);
        if (existing) return { threadId: existing } satisfies OpenFolderSessionResult;
        // Re-discover rather than trust the request: only a session recorded for this
        // project's folder, in the named account, may be opened.
        const found = (yield* discoverProjectSessions(input.projectId)).find(
          (candidate) =>
            candidate.session.provider === input.provider &&
            candidate.session.externalId === input.externalId &&
            candidate.source.instanceId === input.providerInstanceId,
        );
        if (!found)
          return yield* new ProjectImportError({
            message: "This session is no longer available for this folder.",
          });
        const { session, source } = found;
        const project = yield* findProject(input.projectId);
        const projectDefault = project.defaultModelSelection;
        const modelSelection: ModelSelection =
          projectDefault?.provider === session.provider &&
          (projectDefault.instanceId ?? projectDefault.provider) === source.instanceId
            ? projectDefault
            : ({
                provider: session.provider,
                ...(source.isDefault ? {} : { instanceId: source.instanceId }),
                model: DEFAULT_MODEL_BY_PROVIDER[session.provider],
              } as ModelSelection);
        const threadId = ThreadId.makeUnsafe(crypto.randomUUID());
        const createdAt = new Date().toISOString();
        yield* options.orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          threadId,
          projectId: project.id,
          // Chat titles cannot be empty; a session listed as "Untitled session" (no
          // name, and its first prompt past the bounded read) still opens.
          title: session.title || UNTITLED_SESSION_TITLE[session.provider],
          modelSelection,
          runtimeMode: "approval-required",
          interactionMode: "default",
          envMode: "local",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        const imported = yield* Effect.exit(
          options.importThread(
            { threadId, externalId: session.externalId },
            { continueInPlace: true },
          ),
        );
        if (imported._tag === "Failure") {
          // Leave no empty chat behind a session that could not be resumed.
          yield* options.orchestrationEngine
            .dispatch({
              type: "thread.delete",
              commandId: CommandId.makeUnsafe(crypto.randomUUID()),
              threadId,
            })
            .pipe(Effect.ignore);
          return yield* imported;
        }
        return { threadId } satisfies OpenFolderSessionResult;
      }),
    );

  /**
   * "Continue in terminal": the command that resumes this chat's own native session.
   * It reads the same provider binding that marks a folder session as open, so the id
   * is the one Lattice resumes on its next turn.
   */
  const getNativeSessionHandoff = Effect.fn(function* (input: GetNativeSessionHandoffInput) {
    const model = yield* options.orchestrationEngine.getReadModel();
    const thread = model.threads.find(
      (entry) => entry.id === input.threadId && entry.deletedAt === null,
    );
    const project = thread
      ? model.projects.find((entry) => entry.id === thread.projectId && entry.deletedAt === null)
      : undefined;
    if (!thread || !project)
      return yield* new ProjectImportError({ message: "This chat is no longer open." });

    const binding = (yield* options.repository.listNativeBindings()).find(
      (entry) => entry.threadId === thread.id,
    );
    // A chat switched to another agent keeps its last binding until the new one starts.
    const provider = binding?.provider ?? thread.modelSelection.provider;
    if (provider !== "codex" && provider !== "claudeAgent")
      return {
        status: "unavailable",
        reason: "unsupportedProvider",
      } satisfies NativeSessionHandoff;
    let cursor: unknown = null;
    try {
      cursor = JSON.parse(binding?.cursor ?? "null");
    } catch {
      cursor = null;
    }
    const nativeId = nativeImportId(provider, cursor);
    if (!nativeId)
      return { status: "unavailable", reason: "noNativeSession" } satisfies NativeSessionHandoff;

    const cwd =
      resolveThreadWorkspaceCwd({ thread, projects: model.projects }) ?? project.workspaceRoot;
    const storeOverride = yield* nativeSessionStoreOverride({
      provider,
      instanceId:
        binding?.providerInstanceId ??
        (thread.modelSelection.provider === provider
          ? resolveModelSelectionInstanceId(thread.modelSelection)
          : provider),
    });
    return {
      status: "available",
      provider,
      nativeId,
      cwd,
      command: buildNativeSessionResumeCommand({
        provider,
        nativeId,
        cwd,
        storeOverride,
        platform: options.platform ?? process.platform,
      }),
    } satisfies NativeSessionHandoff;
  });

  /**
   * The account's store, only when a plain terminal would not read it by default: an
   * account with its own CLAUDE_CONFIG_DIR or CODEX_HOME. The default account on a
   * default install needs no variable, so the command stays short.
   */
  const nativeSessionStoreOverride = Effect.fn(function* (input: {
    readonly provider: ProjectImportProvider;
    readonly instanceId: string;
  }) {
    const settings = yield* options.serverSettings.getSettings;
    const source = resolveProjectImportSources(settings, [input.provider], sourcePaths).find(
      (candidate) => candidate.instanceId === input.instanceId,
    );
    // A deleted account leaves nothing to point at; the default store is the best guess.
    if (!source) return undefined;
    const store =
      source.provider === "codex"
        ? resolveBaseCodexHomePath(source.environment, source.codexHomePath)
        : source.claudeConfigDir;
    if (!store) return undefined;
    const defaultStore = defaultNativeSessionStore(input.provider, options.homeDir ?? homedir());
    const [storeIdentity, defaultIdentity] = yield* projectImportPromise(() =>
      Promise.all([canonicalImportPath(store), canonicalImportPath(defaultStore)]),
    );
    return importPathIdentity(storeIdentity) === importPathIdentity(defaultIdentity)
      ? undefined
      : store;
  });

  return { listFolderSessions, openFolderSession, getNativeSessionHandoff };
}

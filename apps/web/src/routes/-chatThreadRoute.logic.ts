// FILE: chatThreadRoute.logic.ts
// Purpose: Keep route-level chat panel state transitions and fallbacks deterministic.
// Layer: Route UI logic helpers.
// Exports: thread title fallback, deep-link bootstrap replay handling, panel toggle helpers, and
//          the embedded frame's foreign-thread redirect decision.

import type {
  ProjectId,
  ThreadEnvironmentMode,
  ThreadId,
  ThreadSidechatContext,
  TurnId,
} from "@synara/contracts";
import { resolveThreadWorkspaceCwd } from "@synara/shared/threadEnvironment";

import type { ChatRightPanel, DiffRouteSearch } from "../diffRouteSearch";

export interface ChatPanelStateSnapshot {
  panel: ChatRightPanel | null;
  diffTurnId: TurnId | null;
  diffFilePath: string | null;
}

export interface ChatPanelStatePatch {
  panel?: ChatRightPanel | null;
  diffTurnId?: TurnId | null;
  diffFilePath?: string | null;
}

export interface RoutePanelBootstrapResult {
  nextAppliedSearchKey: string | null;
  panelPatch: ChatPanelStatePatch | null;
}

export type SplitPaneCloseDecision =
  | {
      kind: "single-thread";
      threadId: ThreadId;
      splitViewIdToRemove: string;
    }
  | {
      kind: "split-thread";
      threadId: ThreadId;
      splitViewId: string;
    }
  | {
      kind: "new-chat";
    };

export function resolveThreadPickerTitle(title: string | null): string {
  return title || "New chat";
}

// File previews follow the thread runtime cwd so worktree chats open the files they actually edit.
export function resolveFilePreviewWorkspaceRoot(input: {
  projectCwd?: string | null | undefined;
  threadEnvMode?: ThreadEnvironmentMode | null | undefined;
  threadWorktreePath?: string | null | undefined;
  threadWorkingDirectory?: string | null | undefined;
}): string | null {
  return resolveThreadWorkspaceCwd({
    projectCwd: input.projectCwd,
    envMode: input.threadEnvMode,
    worktreePath: input.threadWorktreePath,
    workingDirectory: input.threadWorkingDirectory,
  });
}

export function resolveSingleProjectId(input: {
  threadProjectId: ProjectId | null;
  draftProjectId: ProjectId | null;
}): ProjectId | null {
  return input.threadProjectId ?? input.draftProjectId ?? null;
}

export function resolveEmbeddedDraftProjectRebind(input: {
  draftProjectId: ProjectId | null;
  embeddedProjectId: ProjectId | null;
}): ProjectId | null {
  if (
    input.draftProjectId === null ||
    input.embeddedProjectId === null ||
    input.draftProjectId === input.embeddedProjectId
  ) {
    return null;
  }
  return input.embeddedProjectId;
}

/**
 * What an embedded frame's thread route should do with the thread it is on. Lattice binds each
 * frame to one workspace project, and the route renders only that project's threads.
 * - `idle`: nothing to decide yet (not embedded, project not bound, or the thread is unknown).
 * - `own`: the thread or draft belongs to the frame's project; a draft of another project is
 *   moved onto it first.
 * - `leave`: a thread of another project, seen for the first time on this visit.
 * - `left`: the frame already tried to leave this thread on this visit.
 */
export type EmbeddedThreadRouteDecision =
  | { readonly kind: "idle"; readonly redirectedFromThreadId: ThreadId | null }
  | {
      readonly kind: "own";
      readonly rebindDraftToProjectId: ProjectId | null;
      readonly redirectedFromThreadId: null;
    }
  | { readonly kind: "leave"; readonly redirectedFromThreadId: ThreadId }
  | { readonly kind: "left"; readonly redirectedFromThreadId: ThreadId };

/**
 * The route component stays mounted while `$threadId` changes, so the "already redirected" guard
 * lives across visits. It holds the foreign thread the frame last left, and any own-project
 * route clears it: the next foreign thread, even the same one again, is left again.
 */
export function resolveEmbeddedThreadRoute(input: {
  readonly embeddedProjectId: ProjectId | null;
  readonly threadsHydrated: boolean;
  readonly threadId: ThreadId;
  /** The server thread's project, or null while the thread is not in the store. */
  readonly threadProjectId: ProjectId | null;
  /** The route's draft, or null when there is none. */
  readonly draft: { readonly projectId: ProjectId | null } | null;
  readonly redirectedFromThreadId: ThreadId | null;
}): EmbeddedThreadRouteDecision {
  const { embeddedProjectId, redirectedFromThreadId } = input;
  if (embeddedProjectId === null) {
    return { kind: "idle", redirectedFromThreadId };
  }
  if (input.threadProjectId === null) {
    if (input.draft === null) {
      // Not loaded yet, or gone: the missing-thread recovery owns this route.
      return { kind: "idle", redirectedFromThreadId };
    }
    return {
      kind: "own",
      rebindDraftToProjectId: resolveEmbeddedDraftProjectRebind({
        draftProjectId: input.draft.projectId,
        embeddedProjectId,
      }),
      redirectedFromThreadId: null,
    };
  }
  if (input.threadProjectId === embeddedProjectId) {
    return { kind: "own", rebindDraftToProjectId: null, redirectedFromThreadId: null };
  }
  if (!input.threadsHydrated) {
    return { kind: "idle", redirectedFromThreadId };
  }
  return redirectedFromThreadId === input.threadId
    ? { kind: "left", redirectedFromThreadId }
    : { kind: "leave", redirectedFromThreadId: input.threadId };
}

/**
 * Where an embedded frame goes when it leaves another project's thread: back to the last thread of
 * its own project it showed, else that project's most recent thread. Null means there is neither,
 * and the caller opens the project's chat draft (reused, never a fresh one).
 */
export function resolveEmbeddedForeignThreadReturnTarget(input: {
  readonly lastOwnThreadId: ThreadId | null;
  /** The frame project's threads and drafts that can still be opened. */
  readonly isOpenableOwnThread: (threadId: ThreadId) => boolean;
  /** The frame project's threads, most recent first. */
  readonly recentOwnThreadIds: readonly ThreadId[];
}): ThreadId | null {
  if (input.lastOwnThreadId !== null && input.isOpenableOwnThread(input.lastOwnThreadId)) {
    return input.lastOwnThreadId;
  }
  return input.recentOwnThreadIds[0] ?? null;
}

export function normalizeSingleSearchFromPane(
  panelState: Pick<ChatPanelStateSnapshot, "panel" | "diffTurnId" | "diffFilePath">,
): DiffRouteSearch {
  if (panelState.panel === "browser") {
    return { panel: "browser" };
  }
  if (panelState.panel === "diff") {
    return {
      panel: "diff",
      diff: "1",
      ...(panelState.diffTurnId ? { diffTurnId: panelState.diffTurnId } : {}),
      ...(panelState.diffFilePath ? { diffFilePath: panelState.diffFilePath } : {}),
    };
  }
  return {};
}

export function stripEditorViewSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "view" | "editorFilePath"> {
  const { view: _view, editorFilePath: _editorFilePath, ...rest } = params;
  return rest as Omit<T, "view" | "editorFilePath">;
}

export function collectParentDirectoryPaths(filePath: string): string[] {
  const segments = filePath.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return [];
  }

  const parents: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    parents.push(segments.slice(0, index).join("/"));
  }
  return parents;
}

function createRoutePanelSearchKey(input: {
  scopeId: string;
  search: DiffRouteSearch;
}): string | null {
  const { scopeId, search } = input;
  if (
    search.panel === undefined &&
    search.diff === undefined &&
    search.diffTurnId === undefined &&
    search.diffFilePath === undefined
  ) {
    return null;
  }

  return JSON.stringify({
    scopeId,
    panel: search.panel ?? (search.diff ? "diff" : null),
    diffTurnId: search.diffTurnId ?? null,
    diffFilePath: search.diffFilePath ?? null,
  });
}

export function resolveRoutePanelBootstrap(input: {
  scopeId: string;
  search: DiffRouteSearch;
  lastAppliedSearchKey: string | null;
}): RoutePanelBootstrapResult {
  const nextAppliedSearchKey = createRoutePanelSearchKey({
    scopeId: input.scopeId,
    search: input.search,
  });

  if (nextAppliedSearchKey === null) {
    return {
      nextAppliedSearchKey: null,
      panelPatch: null,
    };
  }

  if (input.lastAppliedSearchKey === nextAppliedSearchKey) {
    return {
      nextAppliedSearchKey,
      panelPatch: null,
    };
  }

  return {
    nextAppliedSearchKey,
    panelPatch: {
      panel: input.search.panel ?? (input.search.diff ? "diff" : null),
      diffTurnId: input.search.diffTurnId ?? null,
      diffFilePath: input.search.diffFilePath ?? null,
    },
  };
}

export function resolveToggledChatPanelPatch(
  previousState: ChatPanelStateSnapshot,
  panel: ChatRightPanel,
): ChatPanelStatePatch {
  return {
    panel: previousState.panel === panel ? null : panel,
    diffTurnId: previousState.diffTurnId,
    diffFilePath: previousState.diffFilePath,
  };
}

// Closing a sidechat is a return-to-source action; generic pane closes can still fall back normally.
export function resolveSplitPaneCloseDecision(input: {
  splitViewId: string;
  sourceThreadId: ThreadId;
  closingThreadId: ThreadId | null | undefined;
  closingSidechatSourceThreadId: ThreadId | null | undefined;
  closingSidechatContext?: ThreadSidechatContext | null | undefined;
  nextFocusedThreadId: ThreadId | null | undefined;
  nextLeafCount: number;
}): SplitPaneCloseDecision {
  if (input.closingSidechatSourceThreadId) {
    return {
      kind: "single-thread",
      threadId: input.closingSidechatSourceThreadId,
      splitViewIdToRemove: input.splitViewId,
    };
  }

  if (
    input.closingSidechatContext &&
    input.closingThreadId &&
    input.closingThreadId !== input.sourceThreadId
  ) {
    return {
      kind: "single-thread",
      threadId: input.sourceThreadId,
      splitViewIdToRemove: input.splitViewId,
    };
  }

  if (input.nextFocusedThreadId) {
    if (input.nextLeafCount <= 1) {
      return {
        kind: "single-thread",
        threadId: input.nextFocusedThreadId,
        splitViewIdToRemove: input.splitViewId,
      };
    }
    return {
      kind: "split-thread",
      threadId: input.nextFocusedThreadId,
      splitViewId: input.splitViewId,
    };
  }

  return { kind: "new-chat" };
}

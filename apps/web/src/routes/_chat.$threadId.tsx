// FILE: _chat.$threadId.tsx
// Purpose: Resolve the active thread route into either a single chat surface or a persisted split view.
// Layer: Route container

import { type ProjectId, ThreadId } from "@synara/contracts";
import { workspaceRootsEqual } from "@synara/shared/threadWorkspace";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type EmptyRouteRestoreRecoveryState,
  shouldHoldMissingThreadRouteFallback,
  shouldStartMissingThreadRouteRecovery,
} from "../chatRouteRestore";
import { refreshEmptyRouteRestoreSnapshot, waitForEmptyRouteRestoreFallbackDelay } from "../chatRouteRecovery";
import { useComposerDraftStore } from "../composerDraftStore";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import { postEmbedReadyToLattice } from "../embedMode";
import { useEmbeddedWorkspaceProject } from "../hooks/useEmbeddedWorkspaceProject";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { readNativeApi } from "../nativeApi";
import { isSplitRoute } from "../splitViewRoute";
import { selectSplitView, useSplitViewStore } from "../splitViewStore";
import { useStore } from "../store";
import { createThreadExistsSelector, createThreadProjectIdSelector } from "../storeSelectors";
import { SingleChatSurface } from "../components/chat/SingleChatSurface";
import { SplitChatSurface } from "../components/chat/SplitChatSurface";
import { resolveEmbeddedDraftProjectRebind, resolveSingleProjectId } from "./-chatThreadRoute.logic";

function ChatThreadRouteView() {
  const { embedMode, projectId: embeddedProjectId, bindingError: embedBindingError } = useEmbeddedWorkspaceProject();
  const { handleNewThread } = useHandleNewThread();
  const embedNavigationProjectIdRef = useRef<ProjectId | null>(null);
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const hasKnownServerThreads = useStore((store) => (store.threadIds?.length ?? 0) > 0);
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = Route.useSearch();
  const threadProjectIdSelector = createThreadProjectIdSelector(threadId);
  const threadExistsSelector = createThreadExistsSelector(threadId);
  const threadProjectId: ProjectId | null = useStore(threadProjectIdSelector);
  const threadExists = useStore(threadExistsSelector);
  const draftThreadState = useComposerDraftStore((store) => store.draftThreadsByThreadId[threadId] ?? null);
  const moveDraftThreadToProject = useComposerDraftStore((store) => store.moveDraftThreadToProject);
  const draftThreadExists = draftThreadState !== null;
  const routeThreadExists = threadExists || draftThreadExists;
  const splitView = useSplitViewStore(useMemo(() => selectSplitView(search.splitViewId ?? null), [search.splitViewId]));
  const splitViewsHydrated = useSplitViewStore((store) => store.hasHydrated);
  const activeProjectId = resolveSingleProjectId({
    threadProjectId,
    draftProjectId: draftThreadState?.projectId ?? null,
  });
  const activeProject = useStore((store) =>
    activeProjectId ? (store.projects.find((project) => project.id === activeProjectId) ?? null) : null,
  );
  const activeProjectCwd = activeProject?.cwd ?? null;
  const navigate = useNavigate();
  const [missingThreadRecoveryState, setMissingThreadRecoveryState] = useState<EmptyRouteRestoreRecoveryState>("idle");
  const mountedRef = useRef(true);
  const missingThreadRecoveryRunRef = useRef(0);
  // Synchronous re-entry guard: the "pending" transition below is deferred (async
  // setState), so this ref keeps the recovery from starting twice in the interim.
  // It is cleared synchronously whenever an episode is invalidated (new thread
  // route, or the thread appearing).
  const recoveryStartedRef = useRef(false);

  useEffect(() => {
    if (!embedMode || !embeddedProjectId) {
      return;
    }

    if (draftThreadState) {
      const rebindProjectId = resolveEmbeddedDraftProjectRebind({
        draftProjectId: draftThreadState.projectId,
        embeddedProjectId,
      });
      if (rebindProjectId) {
        moveDraftThreadToProject(threadId, rebindProjectId);
      }
      return;
    }

    if (
      (activeProjectCwd && workspaceRootsEqual(activeProjectCwd, embedMode.workspaceRoot)) ||
      embedNavigationProjectIdRef.current === embeddedProjectId
    ) {
      return;
    }

    embedNavigationProjectIdRef.current = embeddedProjectId;
    void handleNewThread(
      embeddedProjectId,
      { fresh: true },
      {
        search: () => ({
          embed: "1",
          workspaceRoot: embedMode.workspaceRoot,
          theme: embedMode.theme,
        }),
      },
    );
  }, [
    activeProjectCwd,
    draftThreadState,
    embedMode,
    embeddedProjectId,
    handleNewThread,
    moveDraftThreadToProject,
    threadId,
  ]);

  useEffect(() => {
    if (
      embedMode &&
      routeThreadExists &&
      activeProjectCwd &&
      workspaceRootsEqual(activeProjectCwd, embedMode.workspaceRoot)
    ) {
      postEmbedReadyToLattice(embedMode);
    }
  }, [activeProjectCwd, embedMode, routeThreadExists]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Invalidate any in-flight recovery and start a fresh episode for the new
    // thread route. The run bump + guard reset are synchronous (so a stale async
    // completion cannot stamp "done"); the state reset is deferred async setState.
    missingThreadRecoveryRunRef.current += 1;
    recoveryStartedRef.current = false;
    const timer = window.setTimeout(() => setMissingThreadRecoveryState("idle"), 0);
    return () => window.clearTimeout(timer);
  }, [threadId]);

  useEffect(() => {
    if (routeThreadExists && missingThreadRecoveryState !== "idle") {
      missingThreadRecoveryRunRef.current += 1;
      recoveryStartedRef.current = false;
      const timer = window.setTimeout(() => setMissingThreadRecoveryState("idle"), 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [missingThreadRecoveryState, routeThreadExists]);

  useEffect(() => {
    if (!threadsHydrated || !splitViewsHydrated) {
      return;
    }

    if (!routeThreadExists) {
      if (
        shouldStartMissingThreadRouteRecovery({
          hasKnownServerThreads,
          recoveryState: missingThreadRecoveryState,
          routeThreadExists,
        }) &&
        !recoveryStartedRef.current
      ) {
        recoveryStartedRef.current = true;
        const recoveryRun = (missingThreadRecoveryRunRef.current += 1);
        // Defer the "pending" mark (async setState); the ref guard above prevents a
        // second start before it lands, and the run check skips it if the episode
        // was invalidated in the meantime.
        const pendingTimer = window.setTimeout(() => {
          if (missingThreadRecoveryRunRef.current === recoveryRun) {
            setMissingThreadRecoveryState("pending");
          }
        }, 0);
        void Promise.all([
          refreshEmptyRouteRestoreSnapshot(readNativeApi()).catch(() => false),
          waitForEmptyRouteRestoreFallbackDelay(),
        ]).finally(() => {
          window.clearTimeout(pendingTimer);
          if (mountedRef.current && missingThreadRecoveryRunRef.current === recoveryRun) {
            setMissingThreadRecoveryState("done");
          }
        });
        return;
      }

      if (
        shouldHoldMissingThreadRouteFallback({
          hasKnownServerThreads,
          recoveryState: missingThreadRecoveryState,
          routeThreadExists,
        })
      ) {
        return;
      }
    }

    if (isSplitRoute(search)) {
      if (!splitView) {
        void navigate({
          to: "/$threadId",
          params: { threadId },
          replace: true,
          search: (previous) => ({
            ...stripDiffSearchParams(previous),
            splitViewId: undefined,
          }),
        });
      }
      return;
    }

    if (!routeThreadExists) {
      void navigate({ to: "/", replace: true });
    }
  }, [
    hasKnownServerThreads,
    missingThreadRecoveryState,
    navigate,
    routeThreadExists,
    search,
    splitView,
    splitViewsHydrated,
    threadId,
    threadsHydrated,
  ]);

  if (
    !threadsHydrated ||
    !splitViewsHydrated ||
    (embedMode !== null &&
      embedBindingError === null &&
      (embeddedProjectId === null || activeProjectId !== embeddedProjectId)) ||
    shouldHoldMissingThreadRouteFallback({
      hasKnownServerThreads,
      recoveryState: missingThreadRecoveryState,
      routeThreadExists,
    })
  ) {
    return null;
  }

  if (splitView && search.splitViewId) {
    return <SplitChatSurface splitViewId={search.splitViewId} routeThreadId={threadId} />;
  }

  if (!routeThreadExists) {
    return null;
  }

  return (
    <>
      {embedBindingError ? (
        <div className="absolute inset-x-3 top-3 z-50 rounded-md border border-destructive/30 bg-background/95 px-3 py-2 text-xs text-destructive shadow">
          Project binding failed: {embedBindingError}
        </div>
      ) : null}
      <SingleChatSurface
        threadId={threadId}
        search={search}
        projectId={activeProjectId}
        embedMode={embedMode !== null}
      />
    </>
  );
}

export const Route = createFileRoute("/_chat/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  component: ChatThreadRouteView,
});

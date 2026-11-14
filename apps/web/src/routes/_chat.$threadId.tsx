// FILE: _chat.$threadId.tsx
// Purpose: Resolve the active thread route into either a single chat surface or a persisted split view.
// Layer: Route container

import { t } from "~/i18n";
import { type ProjectId, ThreadId } from "@synara/contracts";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type EmptyRouteRestoreRecoveryState,
  shouldHoldMissingThreadRouteFallback,
  shouldStartMissingThreadRouteRecovery,
} from "../chatRouteRestore";
import {
  refreshEmptyRouteRestoreSnapshot,
  waitForEmptyRouteRestoreFallbackDelay,
} from "../chatRouteRecovery";
import { useComposerDraftStore } from "../composerDraftStore";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import { withLatticeEmbedSearch } from "../embedMode";
import { useEmbeddedWorkspaceProject } from "../hooks/useEmbeddedWorkspaceProject";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { listProjectThreadIdsByRecency } from "../lib/embedThreadScope";
import { readNativeApi } from "../nativeApi";
import { isSplitRoute } from "../splitViewRoute";
import { selectSplitView, useSplitViewStore } from "../splitViewStore";
import { useStore } from "../store";
import { createThreadExistsSelector, createThreadProjectIdSelector } from "../storeSelectors";
import { ChatPaneKeepAliveProvider } from "../components/chat/ChatPaneKeepAlive";
import { SingleChatSurface } from "../components/chat/SingleChatSurface";
import { SplitChatSurface } from "../components/chat/SplitChatSurface";
import { Button } from "../components/ui/button";
import { Empty, EmptyContent, EmptyDescription } from "../components/ui/empty";
import {
  resolveEmbeddedForeignThreadReturnTarget,
  resolveEmbeddedThreadRoute,
  resolveSingleProjectId,
} from "./-chatThreadRoute.logic";

// How long an embedded frame may stay on another project's thread after starting to leave it
// before the route shows the fallback instead of an empty panel.
const EMBED_FOREIGN_THREAD_LEAVE_TIMEOUT_MS = 1_000;

/** The embedded frame tried to leave another project's thread and is still on it. */
interface StuckForeignThread {
  readonly threadId: ThreadId;
  readonly returnThreadId: ThreadId | null;
}

// Where an embedded frame lands when it cannot show the thread it was sent to (a route blocker
// refused to leave it). Better a way out than an empty panel nothing else can recover.
function EmbeddedForeignThreadFallback(props: {
  readonly onNewChat: () => void;
  readonly onBack: (() => void) | null;
}) {
  return (
    <Empty className="h-full">
      <EmptyContent>
        <EmptyDescription>{t("lattice:thisConversationBelongsToAnotherProject")}</EmptyDescription>
        <div className="flex items-center gap-2">
          {props.onBack ? (
            <Button type="button" variant="outline" size="sm" onClick={props.onBack}>
              {t("lattice:back")}
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={props.onNewChat}>
            {t("lattice:newChat")}
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  );
}

// The single and split surfaces swap below this provider, which keeps the chat they both
// show mounted across the swap.
function ChatThreadRouteView() {
  return (
    <ChatPaneKeepAliveProvider>
      <ChatThreadRouteContent />
    </ChatPaneKeepAliveProvider>
  );
}

function ChatThreadRouteContent() {
  const {
    embedMode,
    projectId: embeddedProjectId,
    bindingError: embedBindingError,
  } = useEmbeddedWorkspaceProject();
  const { handleNewThread } = useHandleNewThread();
  // The component stays mounted while `$threadId` changes, so these refs span thread visits:
  // the foreign thread this visit already left (cleared on any own-project route), and the last
  // own-project thread or draft the frame showed, which is where leaving goes back to.
  const embedRedirectedFromThreadIdRef = useRef<ThreadId | null>(null);
  const embedLastOwnThreadIdRef = useRef<ThreadId | null>(null);
  const [stuckForeignThread, setStuckForeignThread] = useState<StuckForeignThread | null>(null);
  const router = useRouter();
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
  const draftThreadState = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId] ?? null,
  );
  const moveDraftThreadToProject = useComposerDraftStore((store) => store.moveDraftThreadToProject);
  const draftThreadExists = draftThreadState !== null;
  const routeThreadExists = threadExists || draftThreadExists;
  const splitView = useSplitViewStore(
    useMemo(() => selectSplitView(search.splitViewId ?? null), [search.splitViewId]),
  );
  const splitViewsHydrated = useSplitViewStore((store) => store.hasHydrated);
  const activeProjectId = resolveSingleProjectId({
    threadProjectId,
    draftProjectId: draftThreadState?.projectId ?? null,
  });
  const navigate = useNavigate();
  const [missingThreadRecoveryState, setMissingThreadRecoveryState] =
    useState<EmptyRouteRestoreRecoveryState>("idle");
  const mountedRef = useRef(true);
  const missingThreadRecoveryRunRef = useRef(0);
  // Synchronous re-entry guard: the "pending" transition below is deferred (async
  // setState), so this ref keeps the recovery from starting twice in the interim.
  // It is cleared synchronously whenever an episode is invalidated (new thread
  // route, or the thread appearing).
  const recoveryStartedRef = useRef(false);

  useEffect(() => {
    if (!embedMode) {
      return;
    }
    const decision = resolveEmbeddedThreadRoute({
      embeddedProjectId,
      threadsHydrated,
      threadId,
      threadProjectId,
      draft: draftThreadState ? { projectId: draftThreadState.projectId } : null,
      redirectedFromThreadId: embedRedirectedFromThreadIdRef.current,
    });
    embedRedirectedFromThreadIdRef.current = decision.redirectedFromThreadId;

    if (decision.kind === "own") {
      embedLastOwnThreadIdRef.current = threadId;
      if (decision.rebindDraftToProjectId) {
        moveDraftThreadToProject(threadId, decision.rebindDraftToProjectId);
      }
      if (stuckForeignThread) {
        const timer = window.setTimeout(() => setStuckForeignThread(null), 0);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    if (decision.kind !== "leave" || !embeddedProjectId) {
      return;
    }

    // Leave for the frame's own conversation, never a freshly minted thread: Lattice persists the
    // frame's thread, and an empty one would replace the conversation the writer was in.
    const storeState = useStore.getState();
    const draftThreadsByThreadId = useComposerDraftStore.getState().draftThreadsByThreadId;
    const returnThreadId = resolveEmbeddedForeignThreadReturnTarget({
      lastOwnThreadId: embedLastOwnThreadIdRef.current,
      isOpenableOwnThread: (candidate) =>
        (storeState.threadShellById?.[candidate]?.projectId ??
          draftThreadsByThreadId[candidate]?.projectId) === embeddedProjectId,
      recentOwnThreadIds: listProjectThreadIdsByRecency(storeState, embeddedProjectId),
    });
    if (returnThreadId) {
      void navigate({
        to: "/$threadId",
        params: { threadId: returnThreadId },
        replace: true,
        search: withLatticeEmbedSearch(() => ({})),
      });
    } else {
      // The project has no thread yet: open its chat draft, reused rather than minted anew.
      void handleNewThread(embeddedProjectId, undefined, { search: () => ({}) });
    }
    // A route blocker that refuses to leave (an unsaved editor whose save failed) leaves
    // `navigate`'s promise pending, so check where the frame is instead of awaiting it. The
    // timer is not cleared when this effect re-runs: leaving happens once per visit.
    window.setTimeout(() => {
      if (mountedRef.current && router.state.location.pathname === `/${threadId}`) {
        setStuckForeignThread({ threadId, returnThreadId });
      }
    }, EMBED_FOREIGN_THREAD_LEAVE_TIMEOUT_MS);
    return undefined;
  }, [
    draftThreadState,
    embedMode,
    embeddedProjectId,
    handleNewThread,
    moveDraftThreadToProject,
    navigate,
    router,
    stuckForeignThread,
    threadId,
    threadProjectId,
    threadsHydrated,
  ]);

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

  const embedRouteBlocked =
    embedMode !== null &&
    embedBindingError === null &&
    (embeddedProjectId === null || activeProjectId !== embeddedProjectId);
  if (
    embedRouteBlocked &&
    embeddedProjectId !== null &&
    stuckForeignThread?.threadId === threadId &&
    threadsHydrated
  ) {
    const { returnThreadId } = stuckForeignThread;
    return (
      <EmbeddedForeignThreadFallback
        onNewChat={() => void handleNewThread(embeddedProjectId, { fresh: true })}
        onBack={
          returnThreadId
            ? () =>
                void navigate({
                  to: "/$threadId",
                  params: { threadId: returnThreadId },
                  replace: true,
                  search: withLatticeEmbedSearch(() => ({})),
                })
            : null
        }
      />
    );
  }

  if (
    !threadsHydrated ||
    !splitViewsHydrated ||
    embedRouteBlocked ||
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
        <div className="absolute inset-x-3 top-3 z-50 rounded-md border border-destructive/30 bg-background/95 px-3 py-2 text-ui-xs text-destructive shadow">
          {t("lattice:projectBindingFailed", { error: embedBindingError })}
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

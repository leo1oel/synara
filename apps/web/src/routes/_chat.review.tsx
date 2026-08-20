// FILE: _chat.review.tsx
// Purpose: Render a turn-scoped checkpoint diff as a dedicated Lattice embed
//          surface. The embedded chat has no RightDock, so its Review button
//          hands off to the host, which opens this route in a drawer iframe.
// Layer: Route screen

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ThreadId, TurnId } from "@synara/contracts";
import { LazyDiffPanel } from "../components/chat/ChatThreadSurfacePrimitives";
import { parseLatticeEmbedSearch, type LatticeEmbedSearch } from "../embedMode";
import { useEmbeddedWorkspaceProject } from "../hooks/useEmbeddedWorkspaceProject";
import { retainThreadDetailSubscription } from "../threadDetailSubscriptionRetention";

export interface ReviewRouteSearch extends LatticeEmbedSearch {
  threadId?: string;
  turnId?: string;
  filePath?: string;
}

function parseReviewSearch(search: Record<string, unknown>): ReviewRouteSearch {
  return {
    ...parseLatticeEmbedSearch(search),
    ...(typeof search.threadId === "string" && search.threadId
      ? { threadId: search.threadId }
      : {}),
    ...(typeof search.turnId === "string" && search.turnId ? { turnId: search.turnId } : {}),
    ...(typeof search.filePath === "string" && search.filePath
      ? { filePath: search.filePath }
      : {}),
  };
}

function ReviewRouteView() {
  const { embedMode, bindingError } = useEmbeddedWorkspaceProject();
  const search = Route.useSearch();
  // The host pins the turn via the URL; file selection stays local so clicking
  // through the file tree does not navigate the drawer iframe.
  const [panelState, setPanelState] = useState<{
    panel: "diff";
    diffTurnId: TurnId | null;
    diffFilePath: string | null;
  }>(() => ({
    panel: "diff",
    diffTurnId: search.turnId ? TurnId.makeUnsafe(search.turnId) : null,
    diffFilePath: search.filePath ?? null,
  }));

  // Only routes that retain a detail subscription get the thread's
  // turnDiffSummaries hydrated; without them the DiffPanel cannot resolve the
  // pinned turn's checkpoint range and reports "no patch available".
  const threadId = search.threadId ?? null;
  useEffect(() => {
    if (!threadId) return;
    return retainThreadDetailSubscription(ThreadId.makeUnsafe(threadId));
  }, [threadId]);

  if (!embedMode) {
    return (
      <div className="grid h-svh place-items-center bg-background px-6 text-sm text-muted-foreground">
        Turn review embed mode requires a Lattice workspace.
      </div>
    );
  }
  if (!search.threadId || !search.turnId) {
    return (
      <div className="grid h-svh place-items-center bg-background px-6 text-sm text-muted-foreground">
        This surface needs a thread and turn to review.
      </div>
    );
  }

  return (
    <div className="h-svh min-h-0 w-full bg-background text-[var(--color-text-foreground)]">
      {bindingError ? (
        <div className="absolute inset-x-3 top-11 z-50 rounded-md border border-destructive/30 bg-background/95 px-3 py-2 text-xs text-destructive shadow">
          Project binding failed: {bindingError}
        </div>
      ) : null}
      {/* "sidebar" fills the container; "inline" is a fixed 42vw/560px side
          column and would refuse to track the host drawer's width. */}
      <LazyDiffPanel
        mode="sidebar"
        threadId={ThreadId.makeUnsafe(search.threadId)}
        panelState={panelState}
        onUpdatePanelState={(patch) =>
          setPanelState((previous) => ({
            panel: "diff",
            diffTurnId: "diffTurnId" in patch ? (patch.diffTurnId ?? null) : previous.diffTurnId,
            diffFilePath:
              "diffFilePath" in patch ? (patch.diffFilePath ?? null) : previous.diffFilePath,
          }))
        }
      />
    </div>
  );
}

export const Route = createFileRoute("/_chat/review")({
  validateSearch: parseReviewSearch,
  component: ReviewRouteView,
});

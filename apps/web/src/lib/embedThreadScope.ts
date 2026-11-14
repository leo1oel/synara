// FILE: embedThreadScope.ts
// Purpose: Which threads a Lattice embedded frame may show. Lattice binds each frame to one
//          workspace project, while every frame's store holds every project's threads.
// Layer: Web app embed helpers
// Exports: the frame's project, the foreign-thread check, and the project's threads by recency.

import type { ProjectId, ThreadId } from "@synara/contracts";

import { sortThreadsForSidebar } from "../components/Sidebar.logic";
import { embedWorkspaceMatches, type EmbedModeConfig } from "../embedMode";
import type { AppState } from "../storeState";
import { createSidebarDisplayThreadsSelector } from "../storeSelectors";

/** The project bound to the frame's workspace, matched as useEmbeddedWorkspaceProject does. */
export function resolveEmbeddedProjectId(
  state: AppState,
  embedMode: EmbedModeConfig | null,
): ProjectId | null {
  if (!embedMode) return null;
  return (
    state.projects.find((project) => embedWorkspaceMatches(embedMode, project.cwd))?.id ?? null
  );
}

/**
 * Whether opening `threadId` would take an embedded frame to another project's thread. A thread or
 * frame project the store does not know yet is not foreign: the thread route decides it once both
 * have loaded.
 */
export function isForeignEmbeddedThread(
  state: AppState,
  embedMode: EmbedModeConfig | null,
  threadId: ThreadId,
): boolean {
  const embeddedProjectId = resolveEmbeddedProjectId(state, embedMode);
  const threadProjectId = state.threadShellById?.[threadId]?.projectId ?? null;
  return (
    embeddedProjectId !== null && threadProjectId !== null && threadProjectId !== embeddedProjectId
  );
}

/** The project's top-level threads, most recently updated first. */
export function listProjectThreadIdsByRecency(state: AppState, projectId: ProjectId): ThreadId[] {
  const threads = createSidebarDisplayThreadsSelector()(state).filter(
    (thread) => thread.projectId === projectId,
  );
  return sortThreadsForSidebar(threads, "updated_at", { attentionFirst: false }).map(
    (thread) => thread.id,
  );
}

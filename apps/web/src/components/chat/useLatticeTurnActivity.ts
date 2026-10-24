// FILE: useLatticeTurnActivity.ts
// Purpose: Tells Lattice what the embedded panel's active thread is doing
// (`synara:turn-activity`), so Open Slide's canvas can show the agent at work.
// Layer: Chat embed integration

import { useEffect, useMemo, useRef } from "react";

import {
  embedWorkspaceMatches,
  postTurnActivityToLattice,
  readEmbedMode,
  type SynaraTurnActivityMessage,
} from "../../embedMode";
import {
  buildTurnActivityMessage,
  createTurnActivityReporter,
  type TurnActivityReporter,
  type TurnActivitySnapshot,
} from "../../lib/latticeTurnActivity";

// One reporter per frame: split panes hand the active thread to each other and
// a remounted chat view must not reset the pacing or forget a busy thread.
let frameReporter: TurnActivityReporter | null = null;

function reporterForFrame(): TurnActivityReporter | null {
  const config = readEmbedMode();
  if (!config?.hostOrigin) return null;
  frameReporter ??= createTurnActivityReporter({
    post: (message) => postTurnActivityToLattice(config, message),
  });
  return frameReporter;
}

export interface LatticeTurnActivityOptions extends Omit<
  TurnActivitySnapshot,
  "workspaceRoot" | "threadId"
> {
  /** Only the panel's focused chat reports; side and inactive panes stay quiet. */
  enabled: boolean;
  threadId: string | null;
  projectCwd: string | null;
}

export function useLatticeTurnActivity(options: LatticeTurnActivityOptions): void {
  const { enabled, threadId, projectCwd, turnId, turnLive, awaitingInput, workLogEntries } =
    options;
  const { id: providerId, label: providerLabel } = options.provider;
  const config = enabled ? readEmbedMode() : null;
  const workspaceRoot =
    config && threadId && embedWorkspaceMatches(config, projectCwd) ? config.workspaceRoot : null;
  // Work log entries change with every streamed token; compare what is sent.
  const messageKey = useMemo(
    () =>
      workspaceRoot && threadId
        ? JSON.stringify(
            buildTurnActivityMessage({
              workspaceRoot,
              threadId,
              turnId,
              turnLive,
              awaitingInput,
              provider: { id: providerId, label: providerLabel },
              workLogEntries,
            }),
          )
        : null,
    [
      awaitingInput,
      providerId,
      providerLabel,
      threadId,
      turnId,
      turnLive,
      workLogEntries,
      workspaceRoot,
    ],
  );
  const reportedThreadRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const reporter = reporterForFrame();
    if (!reporter) return;
    const message = messageKey ? (JSON.parse(messageKey) as SynaraTurnActivityMessage) : null;
    // The first report after this view (re)mounts is sent even when unchanged,
    // so a host that just reloaded or saw embed-ready is not left stale.
    reporter.report(message, { force: !mountedRef.current });
    mountedRef.current = true;
    reportedThreadRef.current = message?.threadId ?? null;
  }, [enabled, messageKey]);

  useEffect(() => {
    if (!enabled) return;
    return () => {
      mountedRef.current = false;
      // Hand the host an idle for our thread, unless another pane took over.
      const reportedThread = reportedThreadRef.current;
      reportedThreadRef.current = null;
      if (reportedThread) frameReporter?.release(reportedThread);
    };
  }, [enabled]);
}

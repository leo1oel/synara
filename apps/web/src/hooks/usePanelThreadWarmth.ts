// FILE: usePanelThreadWarmth.ts
// Purpose: Keeps the Claude runtime of the thread Lattice's panel shows warm.
// Layer: Chat embed integration

import type {
  ModelSelection,
  OrchestrationShowPanelThreadInput,
  ProjectId,
  RuntimeMode,
  ThreadId,
} from "@synara/contracts";
import { useEffect, useRef } from "react";
import { randomUUID } from "../lib/utils";
import { readNativeApi } from "../nativeApi";

/** One panel per document: the server keys visible-thread leases by it. */
const PANEL_ID = randomUUID();
// The server's lease lasts 3 minutes; renew well inside it.
export const PANEL_THREAD_HEARTBEAT_MS = 60_000;
// Coalesces a thread switch, model change and focus into one report.
export const PANEL_THREAD_REPORT_DELAY_MS = 250;
export const COMPOSER_FOCUS_MIN_INTERVAL_MS = 5_000;

export interface PanelThreadWarmthInput {
  readonly enabled: boolean;
  readonly threadId: ThreadId | null;
  readonly projectId: ProjectId | null;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
}

type SendReport = (input: OrchestrationShowPanelThreadInput) => void;

const sendToServer: SendReport = (input) => {
  void readNativeApi()
    ?.orchestration.showPanelThread(input)
    .catch(() => undefined);
};

/**
 * Report the shown thread now (after a short coalescing delay), on composer
 * focus, and on a heartbeat while the document is visible. Returns the stop.
 */
export function startPanelThreadReports(
  read: () => Omit<PanelThreadWarmthInput, "enabled">,
  send: SendReport = sendToServer,
  panelId: string = PANEL_ID,
): () => void {
  let lastReportAt = 0;
  const report = () => {
    const { threadId, projectId, modelSelection, runtimeMode } = read();
    lastReportAt = Date.now();
    send({
      panelId,
      threadId,
      ...(threadId && projectId ? { prewarm: { projectId, modelSelection, runtimeMode } } : {}),
    });
  };
  const release = () => send({ panelId, threadId: null });
  const timer = window.setTimeout(report, PANEL_THREAD_REPORT_DELAY_MS);
  const heartbeat = window.setInterval(() => {
    if (document.visibilityState === "visible") report();
  }, PANEL_THREAD_HEARTBEAT_MS);
  const onFocusIn = (event: Event) => {
    const target = event.target as { closest?: (selector: string) => unknown } | null;
    if (!target?.closest?.("[data-chat-composer-form]")) return;
    if (Date.now() - lastReportAt >= COMPOSER_FOCUS_MIN_INTERVAL_MS) report();
  };
  document.addEventListener("focusin", onFocusIn);
  window.addEventListener("pagehide", release);
  return () => {
    window.clearTimeout(timer);
    window.clearInterval(heartbeat);
    document.removeEventListener("focusin", onFocusIn);
    window.removeEventListener("pagehide", release);
  };
}

/**
 * Claude Code takes seconds to start, and the panel used to start it only on
 * Send. While a thread is on screen this reports it to the server, which keeps
 * its runtime out of the idle stop and starts it now (opening a thread,
 * focusing the composer, changing the model), so the start overlaps typing.
 * Leaving the thread, or the panel, lets an unused runtime stop.
 */
export function usePanelThreadWarmth(input: PanelThreadWarmthInput): void {
  const latest = useRef(input);
  // Writing a ref during render defeats the React Compiler; sync it after commit.
  useEffect(() => {
    latest.current = input;
  });
  const modelKey = JSON.stringify(input.modelSelection);

  useEffect(() => {
    if (!input.enabled) return;
    return startPanelThreadReports(() => latest.current);
  }, [input.enabled, input.threadId, input.projectId, input.runtimeMode, modelKey]);

  // Unmounting the chat view shows no thread.
  useEffect(() => {
    if (!input.enabled) return;
    return () => sendToServer({ panelId: PANEL_ID, threadId: null });
  }, [input.enabled]);
}

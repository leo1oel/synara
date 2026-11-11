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
import { useEffect, useRef, useSyncExternalStore } from "react";
import { randomUUID } from "../lib/utils";
import { readNativeApi } from "../nativeApi";

/** One panel per document: the server keys visible-thread leases by it. */
const PANEL_ID = randomUUID();
// The server's lease lasts 3 minutes; renew well inside it.
export const PANEL_THREAD_HEARTBEAT_MS = 60_000;
// Coalesces a thread switch, model change and focus into one report.
export const PANEL_THREAD_REPORT_DELAY_MS = 250;
export const COMPOSER_FOCUS_MIN_INTERVAL_MS = 5_000;
// A panel hidden this long gives up its thread; a quicker tab flip keeps the
// warm runtime instead of restarting Claude Code on the way back.
export const PANEL_HIDDEN_RELEASE_DELAY_MS = 30_000;

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

/** Whether the host shows the panel (LATTICE_AGENT_PANEL_VISIBILITY). */
export interface HostPanelVisibility {
  shown(): boolean;
  subscribe(listener: () => void): () => void;
}

// Hidden until Lattice says otherwise: it mounts the frame for a panel that is
// collapsed or behind another tab too, and answers the frame's ready signal
// with the panel's state.
let panelShownByHost = false;
const hostVisibilityListeners = new Set<() => void>();

/** Record the host's LATTICE_AGENT_PANEL_VISIBILITY. */
export function setPanelShownByHost(shown: boolean): void {
  if (shown === panelShownByHost) return;
  panelShownByHost = shown;
  for (const listener of hostVisibilityListeners) listener();
}

const hostPanelVisibility: HostPanelVisibility = {
  shown: () => panelShownByHost,
  subscribe: (listener) => {
    hostVisibilityListeners.add(listener);
    return () => hostVisibilityListeners.delete(listener);
  },
};

/** Whether the host shows the panel, as React state. */
export function usePanelShownByHost(): boolean {
  return useSyncExternalStore(hostPanelVisibility.subscribe, hostPanelVisibility.shown);
}

/**
 * While the panel is on screen (the host shows it and the window is visible),
 * report the shown thread now (after a short coalescing delay), on composer
 * focus, and on a heartbeat. A panel the host hides gives up its thread, so
 * the server's idle stop applies to it again. Returns the stop.
 */
export function startPanelThreadReports(
  read: () => Omit<PanelThreadWarmthInput, "enabled">,
  send: SendReport = sendToServer,
  panelId: string = PANEL_ID,
  host: HostPanelVisibility = hostPanelVisibility,
): () => void {
  let lastReportAt = 0;
  const onScreen = () => host.shown() && document.visibilityState === "visible";
  const report = () => {
    if (!onScreen()) return;
    const { threadId, projectId, modelSelection, runtimeMode } = read();
    lastReportAt = Date.now();
    send({
      panelId,
      threadId,
      ...(threadId && projectId ? { prewarm: { projectId, modelSelection, runtimeMode } } : {}),
    });
  };
  const release = () => send({ panelId, threadId: null });
  let reportTimer: number | undefined;
  const reportSoon = () => {
    window.clearTimeout(reportTimer);
    reportTimer = window.setTimeout(report, PANEL_THREAD_REPORT_DELAY_MS);
  };
  let releaseTimer: number | undefined;
  const onHostVisibility = () => {
    window.clearTimeout(releaseTimer);
    releaseTimer = undefined;
    if (host.shown()) {
      reportSoon();
      return;
    }
    window.clearTimeout(reportTimer);
    releaseTimer = window.setTimeout(release, PANEL_HIDDEN_RELEASE_DELAY_MS);
  };
  // Also releases a thread reported before this run when the panel is hidden.
  onHostVisibility();
  const unsubscribe = host.subscribe(onHostVisibility);
  const heartbeat = window.setInterval(report, PANEL_THREAD_HEARTBEAT_MS);
  const onFocusIn = (event: Event) => {
    const target = event.target as { closest?: (selector: string) => unknown } | null;
    if (!target?.closest?.("[data-chat-composer-form]")) return;
    if (Date.now() - lastReportAt >= COMPOSER_FOCUS_MIN_INTERVAL_MS) report();
  };
  // A lease that lapsed while the window was hidden is renewed on return.
  const onVisibilityChange = () => {
    if (onScreen()) reportSoon();
  };
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", release);
  return () => {
    window.clearTimeout(reportTimer);
    window.clearTimeout(releaseTimer);
    window.clearInterval(heartbeat);
    unsubscribe();
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", release);
  };
}

/**
 * Claude Code takes seconds to start, and the panel used to start it only on
 * Send. While a thread is on screen this reports it to the server, which keeps
 * its runtime out of the idle stop and starts it now (opening a thread,
 * focusing the composer, changing the model, showing the panel), so the start
 * overlaps typing. Leaving the thread, or hiding or closing the panel, lets an
 * unused runtime stop.
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

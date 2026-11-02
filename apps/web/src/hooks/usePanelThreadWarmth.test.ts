import { ProjectId, ThreadId } from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COMPOSER_FOCUS_MIN_INTERVAL_MS,
  PANEL_THREAD_HEARTBEAT_MS,
  PANEL_HIDDEN_RELEASE_DELAY_MS,
  PANEL_THREAD_REPORT_DELAY_MS,
  startPanelThreadReports,
  type HostPanelVisibility,
} from "./usePanelThreadWarmth";

const threadId = ThreadId.makeUnsafe("thread-1");
const projectId = ProjectId.makeUnsafe("project-1");
const modelSelection = { provider: "claudeAgent", model: "claude-sonnet-5" } as const;
const prewarmed = {
  panelId: "panel",
  threadId,
  prewarm: { projectId, modelSelection, runtimeMode: "full-access" },
};

function install(visibilityState = "visible") {
  const win = Object.assign(new EventTarget(), {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  const doc = Object.assign(new EventTarget(), { visibilityState });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  return { win, doc };
}

/** Stands in for Lattice's lattice:agent-panel-visibility messages. */
function hostVisibility(shown: boolean) {
  const listeners = new Set<() => void>();
  const host: HostPanelVisibility & { set(next: boolean): void } = {
    shown: () => shown,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      shown = next;
      for (const listener of listeners) listener();
    },
  };
  return host;
}

const read = () => ({ threadId, projectId, modelSelection, runtimeMode: "full-access" as const });

function focusIn(doc: EventTarget, inComposer: boolean) {
  const event = new Event("focusin");
  Object.defineProperty(event, "target", {
    value: { closest: (selector: string) => (inComposer ? { selector } : null) },
  });
  doc.dispatchEvent(event);
}

describe("panel thread reports", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("warms the shown thread, again on composer focus and heartbeat, and stops cleanly", () => {
    vi.useFakeTimers();
    const { doc } = install();
    const send = vi.fn();
    const stop = startPanelThreadReports(
      () => ({ threadId, projectId, modelSelection, runtimeMode: "full-access" }),
      send,
      "panel",
      hostVisibility(true),
    );
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PANEL_THREAD_REPORT_DELAY_MS);
    expect(send).toHaveBeenLastCalledWith(prewarmed);

    focusIn(doc, true);
    expect(send).toHaveBeenCalledTimes(1); // too soon after the last report
    vi.advanceTimersByTime(COMPOSER_FOCUS_MIN_INTERVAL_MS);
    focusIn(doc, false);
    expect(send).toHaveBeenCalledTimes(1);
    focusIn(doc, true);
    expect(send).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(PANEL_THREAD_HEARTBEAT_MS);
    expect(send).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(PANEL_THREAD_HEARTBEAT_MS * 3);
    focusIn(doc, true);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("neither warms nor renews while the window is hidden and releases on pagehide", () => {
    vi.useFakeTimers();
    const { win } = install("hidden");
    const send = vi.fn();
    startPanelThreadReports(
      () => ({ threadId, projectId, modelSelection, runtimeMode: "full-access" }),
      send,
      "panel",
      hostVisibility(true),
    );
    vi.advanceTimersByTime(PANEL_THREAD_REPORT_DELAY_MS + PANEL_THREAD_HEARTBEAT_MS * 2);
    expect(send).not.toHaveBeenCalled();
    win.dispatchEvent(new Event("pagehide"));
    expect(send).toHaveBeenLastCalledWith({ panelId: "panel", threadId: null });
  });

  it("only reports visibility when there is no thread to warm", () => {
    vi.useFakeTimers();
    install();
    const send = vi.fn();
    startPanelThreadReports(
      () => ({ threadId, projectId: null, modelSelection, runtimeMode: "full-access" }),
      send,
      "panel",
      hostVisibility(true),
    );
    vi.advanceTimersByTime(PANEL_THREAD_REPORT_DELAY_MS);
    expect(send).toHaveBeenLastCalledWith({ panelId: "panel", threadId });
  });

  it("neither warms nor renews a thread while Lattice reports the panel hidden", () => {
    vi.useFakeTimers();
    install();
    const send = vi.fn();
    startPanelThreadReports(read, send, "panel", hostVisibility(false));
    vi.advanceTimersByTime(PANEL_THREAD_REPORT_DELAY_MS + PANEL_THREAD_HEARTBEAT_MS * 3);
    // Only the release, so the server's idle stop applies to the thread.
    expect(send.mock.calls).toEqual([[{ panelId: "panel", threadId: null }]]);
  });

  it("releases the thread once the panel stays hidden and warms it again when shown", () => {
    vi.useFakeTimers();
    install();
    const send = vi.fn();
    const host = hostVisibility(true);
    startPanelThreadReports(read, send, "panel", host);
    vi.advanceTimersByTime(PANEL_THREAD_REPORT_DELAY_MS);
    expect(send).toHaveBeenLastCalledWith(prewarmed);

    // A quick tab flip keeps the warm runtime.
    host.set(false);
    vi.advanceTimersByTime(PANEL_HIDDEN_RELEASE_DELAY_MS / 2);
    host.set(true);
    vi.advanceTimersByTime(PANEL_HIDDEN_RELEASE_DELAY_MS);
    expect(send.mock.calls.every(([input]) => input.threadId === threadId)).toBe(true);

    send.mockClear();
    host.set(false);
    vi.advanceTimersByTime(PANEL_HIDDEN_RELEASE_DELAY_MS + PANEL_THREAD_HEARTBEAT_MS * 3);
    expect(send.mock.calls).toEqual([[{ panelId: "panel", threadId: null }]]);

    host.set(true);
    vi.advanceTimersByTime(PANEL_THREAD_REPORT_DELAY_MS);
    expect(send).toHaveBeenLastCalledWith(prewarmed);
  });

  it("reports at once when the window comes back instead of waiting for the heartbeat", () => {
    vi.useFakeTimers();
    const { doc } = install("hidden");
    const send = vi.fn();
    startPanelThreadReports(read, send, "panel", hostVisibility(true));
    vi.advanceTimersByTime(PANEL_THREAD_REPORT_DELAY_MS);
    expect(send).not.toHaveBeenCalled();
    Object.assign(doc, { visibilityState: "visible" });
    doc.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(PANEL_THREAD_REPORT_DELAY_MS);
    expect(send).toHaveBeenLastCalledWith(prewarmed);
  });
});

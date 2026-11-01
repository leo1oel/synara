import { ProjectId, ThreadId } from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COMPOSER_FOCUS_MIN_INTERVAL_MS,
  PANEL_THREAD_HEARTBEAT_MS,
  PANEL_THREAD_REPORT_DELAY_MS,
  startPanelThreadReports,
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

  it("does not renew while the document is hidden and releases on pagehide", () => {
    vi.useFakeTimers();
    const { win } = install("hidden");
    const send = vi.fn();
    startPanelThreadReports(
      () => ({ threadId, projectId, modelSelection, runtimeMode: "full-access" }),
      send,
      "panel",
    );
    vi.advanceTimersByTime(PANEL_THREAD_REPORT_DELAY_MS + PANEL_THREAD_HEARTBEAT_MS * 2);
    expect(send).toHaveBeenCalledTimes(1);
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
    );
    vi.advanceTimersByTime(PANEL_THREAD_REPORT_DELAY_MS);
    expect(send).toHaveBeenLastCalledWith({ panelId: "panel", threadId });
  });
});

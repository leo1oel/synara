import { afterEach, describe, expect, it, vi } from "vitest";

const { postRequest, config } = vi.hoisted(() => ({
  postRequest: vi.fn(),
  config: {
    workspaceRoot: "/workspace",
    hostOrigin: "https://lattice.test",
    surface: "chrome" as const,
    theme: "dark" as const,
    locale: "en" as const,
  },
}));
vi.mock("../embedMode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../embedMode")>();
  return {
    ...actual,
    readEmbedMode: () => config,
    postHostContextRequestToLattice: postRequest,
    readLatticeHostContextRefreshFailedMessage: (event: MessageEvent) =>
      event.source === window.parent &&
      event.origin === config.hostOrigin &&
      event.data?.type === "lattice:host-context-refresh-failed"
        ? event.data.requestId
        : null,
    readLatticeHostContextMessage: (event: MessageEvent) =>
      event.source === window.parent &&
      event.origin === config.hostOrigin &&
      event.data?.workspaceRoot === config.workspaceRoot
        ? event.data
        : null,
  };
});
vi.mock("./utils", () => ({ randomUUID: () => "refresh-1" }));

import { LATTICE_HOST_CONTEXT_REFRESH_FAILED } from "../embedMode";
import {
  getLiveLatticeHostContext,
  LATTICE_HOST_CONTEXT_SEND_WAIT_MS,
  refreshLatticeHostContextForSend,
  setLiveLatticeHostContext,
} from "./latticeHostContext";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  vi.useRealTimers();
  postRequest.mockClear();
  setLiveLatticeHostContext(null);
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
});

function installWindow() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const parent = {};
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      parent,
      addEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.delete(fn),
      setTimeout,
      clearTimeout,
    },
  });
  return { parent, listeners };
}
const snapshot = (selection?: string) => ({
  type: "lattice:host-context" as const,
  version: 1 as const,
  capturedAt: "2026-09-18T00:00:00Z",
  workspaceRoot: "/workspace",
  activeSurface: "editor" as const,
  editor: { path: "main.tex", line: 1, column: 0, ...(selection ? { selection } : {}) },
});

describe("refreshLatticeHostContextForSend", () => {
  it("requests the configured workspace and accepts only matching source, origin, and request id", async () => {
    const { parent, listeners } = installWindow();
    const promise = refreshLatticeHostContextForSend(1_000);
    expect(postRequest).toHaveBeenCalledWith(config, {
      requestId: "refresh-1",
      refreshComments: true,
    });
    const refreshed = { ...snapshot(), requestId: "refresh-1" };
    for (const event of [
      { source: {}, origin: config.hostOrigin, data: refreshed },
      { source: parent, origin: "https://evil.test", data: refreshed },
      { source: parent, origin: config.hostOrigin, data: { ...refreshed, requestId: "other" } },
      { source: parent, origin: config.hostOrigin, data: refreshed },
    ])
      for (const listener of [...listeners]) listener(event as MessageEvent);
    await expect(promise).resolves.toEqual(refreshed);
    expect(listeners.size).toBe(0);
  });

  it("times out using the latest matching cache and preserves a selection explicitly cleared during refresh", async () => {
    vi.useFakeTimers();
    installWindow();
    setLiveLatticeHostContext(snapshot("old selection"));
    const promise = refreshLatticeHostContextForSend(50);
    setLiveLatticeHostContext(snapshot());
    await vi.advanceTimersByTimeAsync(50);
    await expect(promise).resolves.toMatchObject({
      editor: { path: "main.tex" },
      editorComments: { capturedAt: "2026-09-18T00:00:00Z", overleaf: { status: "unavailable" } },
    });
    expect((await promise)?.editor?.selection).toBeUndefined();
  });

  const comments = (capturedAt: string, body: string) => ({
    workspaceRoot: "/workspace",
    capturedAt,
    comments: [{ body }] as never[],
    omittedCount: 0,
    overleaf: { status: "fresh" as const },
  });

  it("does not hold a send behind a slow host, and folds the late refresh into the cache", async () => {
    vi.useFakeTimers();
    const { parent, listeners } = installWindow();
    const cached = { ...snapshot(), editorComments: comments("t0", "cached") };
    setLiveLatticeHostContext(cached);
    let settled = false;
    const promise = refreshLatticeHostContextForSend().then((context) => {
      settled = true;
      return context;
    });
    await vi.advanceTimersByTimeAsync(LATTICE_HOST_CONTEXT_SEND_WAIT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe(cached);
    expect(LATTICE_HOST_CONTEXT_SEND_WAIT_MS).toBeLessThanOrEqual(300);

    // Lattice pushed a newer editor state, then the Overleaf refresh landed.
    const pushed = { ...snapshot("new selection"), editorComments: comments("t1", "pushed") };
    setLiveLatticeHostContext(pushed);
    const refreshed = { ...snapshot(), requestId: "refresh-1", editorComments: comments("t2", "fresh") };
    for (const listener of [...listeners])
      listener({ source: parent, origin: config.hostOrigin, data: refreshed } as MessageEvent);
    expect(getLiveLatticeHostContext()).toEqual({ ...pushed, editorComments: refreshed.editorComments });
    expect(listeners.size).toBe(0);
  });

  it("sends at the cap when the host never answers and stops listening later", async () => {
    vi.useFakeTimers();
    const { listeners } = installWindow();
    setLiveLatticeHostContext(snapshot());
    const promise = refreshLatticeHostContextForSend();
    await vi.advanceTimersByTimeAsync(LATTICE_HOST_CONTEXT_SEND_WAIT_MS);
    await expect(promise).resolves.toMatchObject({ editor: { path: "main.tex" } });
    expect(listeners.size).toBe(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(listeners.size).toBe(0);
  });

  it("sends immediately when Lattice reports it cannot refresh", async () => {
    vi.useFakeTimers();
    const { parent, listeners } = installWindow();
    const cached = { ...snapshot(), editorComments: comments("t0", "cached") };
    setLiveLatticeHostContext(cached);
    const promise = refreshLatticeHostContextForSend();
    for (const listener of [...listeners])
      listener({
        source: parent,
        origin: config.hostOrigin,
        data: { type: LATTICE_HOST_CONTEXT_REFRESH_FAILED, requestId: "refresh-1" },
      } as MessageEvent);
    await expect(promise).resolves.toBe(cached);
    expect(listeners.size).toBe(0);
  });
});

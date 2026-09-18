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
    readLatticeHostContextMessage: (event: MessageEvent) =>
      event.source === window.parent &&
      event.origin === config.hostOrigin &&
      event.data?.workspaceRoot === config.workspaceRoot
        ? event.data
        : null,
  };
});
vi.mock("./utils", () => ({ randomUUID: () => "refresh-1" }));

import { refreshLatticeHostContextForSend, setLiveLatticeHostContext } from "./latticeHostContext";

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
});

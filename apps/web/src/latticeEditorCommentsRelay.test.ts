import { afterEach, describe, expect, it, vi } from "vitest";
import {
  awaitEditorCommentsHostResult,
  LATTICE_EDITOR_COMMENTS_TOOL_RESULT,
} from "./latticeEditorCommentsRelay";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  vi.restoreAllMocks();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
});
function installWindow() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const parent = { postMessage: vi.fn() };
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
  return { listeners, parent };
}
const request = { id: "r1", workspaceRoot: "/workspace", args: {}, expiresAt: Date.now() + 1_000 };

describe("Lattice editor comments relay", () => {
  it("accepts the paginated Lattice tool response", async () => {
    const { listeners, parent } = installWindow();
    const result = {
      workspaceRoot: "/workspace",
      capturedAt: "2026-09-18T00:00:00Z",
      comments: [],
      omittedCount: 2,
      totalCount: 2,
      offset: 0,
      nextOffset: 1,
      overleaf: { status: "fresh" },
    };
    const promise = awaitEditorCommentsHostResult(
      request,
      "https://lattice.test",
      new AbortController().signal,
    );
    for (const listener of listeners)
      listener({
        source: parent,
        origin: "https://lattice.test",
        data: { type: LATTICE_EDITOR_COMMENTS_TOOL_RESULT, version: 1, id: "r1", ok: true, result },
      } as unknown as MessageEvent);
    await expect(promise).resolves.toMatchObject({ ok: true, result });
  });

  it("rejects a malformed or cross-workspace host result", async () => {
    const { listeners, parent } = installWindow();
    const promise = awaitEditorCommentsHostResult(
      request,
      "https://lattice.test",
      new AbortController().signal,
    );
    for (const listener of listeners)
      listener({
        source: parent,
        origin: "https://lattice.test",
        data: {
          type: LATTICE_EDITOR_COMMENTS_TOOL_RESULT,
          version: 1,
          id: "r1",
          ok: true,
          result: { workspaceRoot: "/other" },
        },
      } as unknown as MessageEvent);
    await expect(promise).resolves.toMatchObject({
      ok: false,
      error: { code: "editor_comments_host_invalid_result" },
    });
    expect(listeners.size).toBe(0);
  });

  it("cleans up its message listener immediately when aborted", async () => {
    const { listeners } = installWindow();
    const controller = new AbortController();
    const promise = awaitEditorCommentsHostResult(
      request,
      "https://lattice.test",
      controller.signal,
    );
    expect(listeners.size).toBe(1);
    controller.abort();
    await expect(promise).resolves.toMatchObject({
      ok: false,
      error: { code: "editor_comments_relay_stopped" },
    });
    expect(listeners.size).toBe(0);
  });
});

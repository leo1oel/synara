import { afterEach, describe, expect, it, vi } from "vitest";

import {
  awaitCanvasHostResult,
  LATTICE_CANVAS_TOOL_RESULT,
  SYNARA_CANVAS_TOOL_REQUEST,
} from "./latticeCanvasRelay";

afterEach(() => vi.restoreAllMocks());

describe("Lattice canvas relay protocol", () => {
  it("posts to the exact host origin and accepts only a correlated trusted response", async () => {
    const listeners = new Set<(event: MessageEvent) => void>();
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        parent,
        addEventListener: (_: string, listener: (event: MessageEvent) => void) =>
          listeners.add(listener),
        removeEventListener: (_: string, listener: (event: MessageEvent) => void) =>
          listeners.delete(listener),
        setTimeout,
        clearTimeout,
      },
    });
    const promise = awaitCanvasHostResult(
      { id: "abc", action: "create", args: { shapes: [] }, expiresAt: Date.now() + 1_000 },
      "https://lattice.test",
      1_000,
    );
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SYNARA_CANVAS_TOOL_REQUEST,
        version: 1,
        id: "abc",
        action: "create",
        args: { shapes: [] },
        expiresAt: expect.any(Number),
      }),
      "https://lattice.test",
    );
    for (const listener of listeners)
      listener({
        source: parent,
        origin: "https://evil.test",
        data: { type: LATTICE_CANVAS_TOOL_RESULT, version: 1, id: "abc", ok: true },
      } as unknown as MessageEvent);
    for (const listener of listeners)
      listener({
        source: parent,
        origin: "https://lattice.test",
        data: {
          type: LATTICE_CANVAS_TOOL_RESULT,
          version: 1,
          id: "abc",
          ok: true,
          result: { created: 1 },
        },
      } as unknown as MessageEvent);
    await expect(promise).resolves.toMatchObject({ id: "abc", ok: true, result: { created: 1 } });
    expect(listeners.size).toBe(0);
  });
});

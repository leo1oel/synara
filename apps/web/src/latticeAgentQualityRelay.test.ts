import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LATTICE_AGENT_COMPILE_RESULT,
  startLatticeAgentQualityRelay,
} from "./latticeAgentQualityRelay";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Lattice agent quality relay", () => {
  it("accepts only the configured host and forwards the content-free body with bearer auth", async () => {
    const listeners = new Set<(event: MessageEvent) => void>();
    const parent = {};
    const storage = new Map<string, string>([
      [
        "synara.poc.embed-mode",
        JSON.stringify({
          workspaceRoot: "/project",
          theme: "light",
          surface: "chrome",
          hostOrigin: "https://lattice.test",
        }),
      ],
      ["synara.poc.embed-auth-token", "secret-bearer"],
    ]);
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        parent,
        addEventListener: (_: string, listener: (event: MessageEvent) => void) =>
          listeners.add(listener),
        removeEventListener: (_: string, listener: (event: MessageEvent) => void) =>
          listeners.delete(listener),
      },
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const stop = startLatticeAgentQualityRelay();
    const result = {
      type: LATTICE_AGENT_COMPILE_RESULT,
      version: 1,
      threadId: "thread-1",
      turnId: "turn-1",
      checkpointRef: "refs/synara/checkpoints/1",
      compiledAt: "2026-08-14T10:00:00.000Z",
      success: true,
      durationMs: 100,
      rootDocument: "main.tex",
      diagnostics: { errors: 0, warnings: 0 },
    };

    for (const listener of listeners) {
      listener({ source: parent, origin: "https://evil.test", data: result } as MessageEvent);
      listener({ source: parent, origin: "https://lattice.test", data: result } as MessageEvent);
    }
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/lattice/agent-quality/compile-result",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer secret-bearer",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(result),
        cache: "no-store",
      }),
    );
    stop();
    expect(listeners.size).toBe(0);
  });
});

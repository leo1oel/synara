import { afterEach, describe, expect, it, vi } from "vitest";

import { LATTICE_HOST_FILE_WRITES, startLatticeHostWritesRelay } from "./latticeHostWritesRelay";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Lattice host writes relay", () => {
  it("forwards host file writes from the configured host only, with bearer auth", async () => {
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
      value: { getItem: (key: string) => storage.get(key) ?? null },
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
    const stop = startLatticeHostWritesRelay();
    const report = {
      type: LATTICE_HOST_FILE_WRITES,
      version: 1,
      workspaceRoot: "/project",
      writes: [{ path: "main.tex", writtenAt: "2026-11-08T10:00:00.000Z" }],
    };

    for (const listener of listeners) {
      listener({ source: parent, origin: "https://evil.test", data: report } as MessageEvent);
      listener({ source: {}, origin: "https://lattice.test", data: report } as MessageEvent);
      listener({
        source: parent,
        origin: "https://lattice.test",
        data: { ...report, version: 2 },
      } as MessageEvent);
      listener({ source: parent, origin: "https://lattice.test", data: report } as MessageEvent);
    }
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/lattice/host-file-writes",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer secret-bearer", "Content-Type": "application/json" },
        body: JSON.stringify(report),
        cache: "no-store",
      }),
    );
    stop();
    expect(listeners.size).toBe(0);
  });
});

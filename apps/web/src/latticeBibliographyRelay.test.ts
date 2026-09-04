import { afterEach, describe, expect, it, vi } from "vitest";

import {
  awaitBibliographyHostResult,
  LATTICE_BIBLIOGRAPHY_TOOL_RESULT,
  parseBibliographyRequest,
  SYNARA_BIBLIOGRAPHY_TOOL_REQUEST,
} from "./latticeBibliographyRelay";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function installWindow() {
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
  return { listeners, parent };
}

describe("Lattice bibliography relay protocol", () => {
  it("posts the project-scoped request and accepts only the trusted host response", async () => {
    const { listeners, parent } = installWindow();
    const request = {
      id: "bibliography-1",
      action: "cite" as const,
      params: { query: "Attention Is All You Need" },
      expiresAt: Date.now() + 1_000,
    };
    const promise = awaitBibliographyHostResult(
      request,
      "https://lattice.test",
      "/workspace/paper",
      1_000,
    );
    expect(parent.postMessage).toHaveBeenCalledWith(
      {
        type: SYNARA_BIBLIOGRAPHY_TOOL_REQUEST,
        version: 1,
        ...request,
        workspaceRoot: "/workspace/paper",
      },
      "https://lattice.test",
    );

    for (const listener of listeners) {
      listener({
        source: parent,
        origin: "https://lattice.test",
        data: {
          type: LATTICE_BIBLIOGRAPHY_TOOL_RESULT,
          version: 1,
          id: request.id,
          ok: true,
          result: { citationKey: "vaswani2017attention" },
        },
      } as unknown as MessageEvent);
    }
    await expect(promise).resolves.toMatchObject({
      ok: true,
      result: { citationKey: "vaswani2017attention" },
    });
    expect(listeners.size).toBe(0);
  });

  it("strictly validates the three polled mutation shapes", () => {
    const request = {
      id: "request-1",
      action: "remove_reference",
      params: { key: "incorrect2024" },
      expiresAt: Date.now() + 1_000,
    };
    expect(parseBibliographyRequest(request)).toEqual(request);
    expect(parseBibliographyRequest({ ...request, action: "write_file" })).toBeNull();
    expect(
      parseBibliographyRequest({
        ...request,
        params: { key: "incorrect2024", path: "references.bib" },
      }),
    ).toBeNull();
    expect(parseBibliographyRequest({ ...request, unexpected: true })).toBeNull();
  });
});

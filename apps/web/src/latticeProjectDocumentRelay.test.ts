import { afterEach, describe, expect, it, vi } from "vitest";

import {
  awaitProjectDocumentHostResult,
  LATTICE_PROJECT_DOCUMENT_TOOL_RESULT,
  parseProjectDocumentRequest,
  SYNARA_PROJECT_DOCUMENT_TOOL_REQUEST,
} from "./latticeProjectDocumentRelay";

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

function dispatch(
  listeners: Set<(event: MessageEvent) => void>,
  event: { readonly source: unknown; readonly origin: string; readonly data: unknown },
) {
  for (const listener of listeners) listener(event as MessageEvent);
}

describe("Lattice project document relay protocol", () => {
  it("posts the exact request and accepts only a matching host response", async () => {
    const { listeners, parent } = installWindow();
    const request = {
      id: "document-1",
      args: { path: "boards/plan.tldr", documentType: "board" as const },
      expiresAt: Date.now() + 1_000,
    };
    const promise = awaitProjectDocumentHostResult(request, "https://lattice.test", 1_000);
    expect(parent.postMessage).toHaveBeenCalledWith(
      {
        type: SYNARA_PROJECT_DOCUMENT_TOOL_REQUEST,
        version: 1,
        ...request,
      },
      "https://lattice.test",
    );

    dispatch(listeners, {
      source: parent,
      origin: "https://evil.test",
      data: {
        type: LATTICE_PROJECT_DOCUMENT_TOOL_RESULT,
        version: 1,
        id: request.id,
        ok: true,
        result: { path: request.args.path, documentType: "board", opened: true },
      },
    });
    dispatch(listeners, {
      source: parent,
      origin: "https://lattice.test",
      data: {
        type: LATTICE_PROJECT_DOCUMENT_TOOL_RESULT,
        version: 1,
        id: request.id,
        ok: true,
        result: { path: "boards/other.tldr", documentType: "board", opened: true },
      },
    });
    await expect(promise).resolves.toMatchObject({
      ok: false,
      error: { code: "project_document_host_invalid_result" },
    });
    expect(listeners.size).toBe(0);
  });

  it("strictly validates polled native document requests", () => {
    const request = {
      id: "request-1",
      args: { path: "tables/results.lattice-sheet", documentType: "spreadsheet" },
      expiresAt: Date.now() + 1_000,
    };
    expect(parseProjectDocumentRequest(request)).toEqual(request);
    expect(
      parseProjectDocumentRequest({
        ...request,
        args: { path: "tables/results.tldr", documentType: "spreadsheet" },
      }),
    ).toBeNull();
    expect(parseProjectDocumentRequest({ ...request, unexpected: true })).toBeNull();
    expect(parseProjectDocumentRequest({ ...request, id: "" })).toBeNull();
  });
});

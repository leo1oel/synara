import { afterEach, describe, expect, it, vi } from "vitest";

import {
  awaitSpreadsheetHostResult,
  LATTICE_SPREADSHEET_TOOL_RESULT,
  parseSpreadsheetRequest,
  SYNARA_SPREADSHEET_TOOL_REQUEST,
} from "./latticeSpreadsheetRelay";

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
  for (const listener of [...listeners]) listener(event as MessageEvent);
}

describe("Lattice spreadsheet relay protocol", () => {
  it("posts the exact request and accepts only a correlated response from the host window", async () => {
    const { listeners, parent } = installWindow();
    const expiresAt = Date.now() + 1_000;
    const promise = awaitSpreadsheetHostResult(
      {
        id: "spreadsheet-abc",
        action: "batch_update",
        args: { version: 1, path: "data.lattice-sheet", operations: [] },
        expiresAt,
      },
      "https://lattice.test",
      1_000,
    );
    expect(parent.postMessage).toHaveBeenCalledWith(
      {
        type: SYNARA_SPREADSHEET_TOOL_REQUEST,
        version: 1,
        id: "spreadsheet-abc",
        action: "batch_update",
        args: { version: 1, path: "data.lattice-sheet", operations: [] },
        expiresAt,
      },
      "https://lattice.test",
    );

    dispatch(listeners, {
      source: parent,
      origin: "https://evil.test",
      data: {
        type: LATTICE_SPREADSHEET_TOOL_RESULT,
        version: 1,
        id: "spreadsheet-abc",
        ok: true,
        result: { changed: 99 },
      },
    });
    dispatch(listeners, {
      source: {},
      origin: "https://lattice.test",
      data: {
        type: LATTICE_SPREADSHEET_TOOL_RESULT,
        version: 1,
        id: "spreadsheet-abc",
        ok: true,
      },
    });
    dispatch(listeners, {
      source: parent,
      origin: "https://lattice.test",
      data: {
        type: LATTICE_SPREADSHEET_TOOL_RESULT,
        version: 1,
        id: "different-id",
        ok: true,
      },
    });
    dispatch(listeners, {
      source: parent,
      origin: "https://lattice.test",
      data: {
        type: LATTICE_SPREADSHEET_TOOL_RESULT,
        version: 1,
        id: "spreadsheet-abc",
        ok: true,
        result: { changed: 11 },
      },
    });

    await expect(promise).resolves.toEqual({
      type: LATTICE_SPREADSHEET_TOOL_RESULT,
      version: 1,
      id: "spreadsheet-abc",
      ok: true,
      result: { changed: 11 },
    });
    expect(listeners.size).toBe(0);
  });

  it("converts malformed or oversized correlated host results into bounded errors", async () => {
    const malformedWindow = installWindow();
    const malformed = awaitSpreadsheetHostResult(
      { id: "malformed", action: "read", args: {}, expiresAt: Date.now() + 1_000 },
      "https://lattice.test",
      1_000,
    );
    dispatch(malformedWindow.listeners, {
      source: malformedWindow.parent,
      origin: "https://lattice.test",
      data: {
        type: LATTICE_SPREADSHEET_TOOL_RESULT,
        version: 1,
        id: "malformed",
        ok: true,
        error: { code: "contradiction", message: "bad" },
      },
    });
    await expect(malformed).resolves.toMatchObject({
      ok: false,
      error: { code: "spreadsheet_host_invalid_result" },
    });

    const oversizedWindow = installWindow();
    const oversized = awaitSpreadsheetHostResult(
      { id: "oversized", action: "read", args: {}, expiresAt: Date.now() + 1_000 },
      "https://lattice.test",
      1_000,
    );
    dispatch(oversizedWindow.listeners, {
      source: oversizedWindow.parent,
      origin: "https://lattice.test",
      data: {
        type: LATTICE_SPREADSHEET_TOOL_RESULT,
        version: 1,
        id: "oversized",
        ok: true,
        result: { value: "x".repeat(384 * 1024) },
      },
    });
    await expect(oversized).resolves.toMatchObject({
      ok: false,
      error: { code: "spreadsheet_result_too_large" },
    });
  });

  it("strictly validates polled request ids, actions, fields, and payload bounds", () => {
    const request = {
      id: "request-1",
      action: "read",
      args: { path: "data.lattice-sheet", range: "A1" },
      expiresAt: Date.now() + 1_000,
    };
    expect(parseSpreadsheetRequest(request)).toEqual(request);
    expect(parseSpreadsheetRequest({ ...request, action: "command" })).toBeNull();
    expect(parseSpreadsheetRequest({ ...request, unexpected: true })).toBeNull();
    expect(parseSpreadsheetRequest({ ...request, id: "" })).toBeNull();
    expect(
      parseSpreadsheetRequest({ ...request, args: { value: "x".repeat(256 * 1024) } }),
    ).toBeNull();
  });
});

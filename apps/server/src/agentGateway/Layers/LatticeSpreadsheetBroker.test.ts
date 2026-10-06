import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";

import { makeLatticeSpreadsheetBroker } from "./LatticeSpreadsheetBroker.ts";

describe("LatticeSpreadsheetBroker", () => {
  it("correlates a host result with the waiting tool call exactly once", async () => {
    const broker = makeLatticeSpreadsheetBroker({
      randomId: () => "spreadsheet-request-1",
      toolTimeoutMs: 1_000,
    });
    const fiber = Effect.runFork(
      broker.invoke("/workspace/a", "read", { path: "data.lattice-sheet", range: "A1" }),
    );
    await expect(Effect.runPromise(broker.poll("/workspace/a"))).resolves.toMatchObject({
      id: "spreadsheet-request-1",
      action: "read",
      args: { path: "data.lattice-sheet", range: "A1" },
    });
    await expect(
      Effect.runPromise(
        broker.complete("/workspace/a", "spreadsheet-request-1", {
          ok: true,
          result: { values: [[1]] },
        }),
      ),
    ).resolves.toBe(true);
    await expect(Effect.runPromise(Fiber.join(fiber))).resolves.toEqual({ values: [[1]] });
    await expect(
      Effect.runPromise(broker.complete("/workspace/a", "spreadsheet-request-1", { ok: true })),
    ).resolves.toBe(false);
  });

  it("times out, removes the request, and rejects late results", async () => {
    const broker = makeLatticeSpreadsheetBroker({
      randomId: () => "spreadsheet-request-2",
      toolTimeoutMs: 5,
      pollTimeoutMs: 5,
    });
    await expect(
      Effect.runPromise(
        broker.invoke("/workspace/a", "batch_update", {
          version: 1,
          path: "data.lattice-sheet",
          operations: [{ type: "clear", range: "A1" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "spreadsheet_tool_timeout" });
    await expect(Effect.runPromise(broker.poll("/workspace/a"))).resolves.toBeNull();
    await expect(
      Effect.runPromise(broker.complete("/workspace/a", "spreadsheet-request-2", { ok: true })),
    ).resolves.toBe(false);
  });

  it("isolates polling and completion by workspace root", async () => {
    const broker = makeLatticeSpreadsheetBroker({
      randomId: () => "spreadsheet-request-3",
      toolTimeoutMs: 1_000,
      pollTimeoutMs: 5,
    });
    const fiber = Effect.runFork(
      broker.invoke("/workspace/a", "read", { path: "data.lattice-sheet", range: "A1" }),
    );
    await expect(Effect.runPromise(broker.poll("/workspace/b"))).resolves.toBeNull();
    await expect(
      Effect.runPromise(broker.complete("/workspace/b", "spreadsheet-request-3", { ok: true })),
    ).resolves.toBe(false);
    await expect(Effect.runPromise(broker.poll("/workspace/a"))).resolves.toMatchObject({
      id: "spreadsheet-request-3",
    });
    await expect(
      Effect.runPromise(broker.complete("/workspace/a", "spreadsheet-request-3", { ok: true })),
    ).resolves.toBe(true);
    await expect(Effect.runPromise(Fiber.join(fiber))).resolves.toBeUndefined();
  });

  it("removes an interrupted request before the host can claim it", async () => {
    const broker = makeLatticeSpreadsheetBroker({
      randomId: () => "spreadsheet-request-4",
      toolTimeoutMs: 1_000,
      pollTimeoutMs: 5,
    });
    const fiber = Effect.runFork(
      broker.invoke("/workspace/a", "batch_update", {
        version: 1,
        path: "data.lattice-sheet",
        operations: [{ type: "clear", range: "A1" }],
      }),
    );
    await Effect.runPromise(Fiber.interrupt(fiber));
    await expect(Effect.runPromise(broker.poll("/workspace/a"))).resolves.toBeNull();
    await expect(
      Effect.runPromise(broker.complete("/workspace/a", "spreadsheet-request-4", { ok: true })),
    ).resolves.toBe(false);
  });
});

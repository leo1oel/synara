import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";

import { makeLatticeCanvasBroker } from "./LatticeCanvasBroker.ts";

describe("LatticeCanvasBroker", () => {
  it("correlates a host result with the waiting tool call exactly once", async () => {
    const broker = makeLatticeCanvasBroker({ randomId: () => "request-1", toolTimeoutMs: 1_000 });
    const fiber = Effect.runFork(broker.invoke("/workspace/a", "list", {}));
    await expect(Effect.runPromise(broker.poll("/workspace/a"))).resolves.toMatchObject({
      id: "request-1",
      action: "list",
      args: {},
    });
    await expect(
      Effect.runPromise(broker.complete("/workspace/a", "request-1", { ok: true, result: { shapes: [] } })),
    ).resolves.toBe(true);
    await expect(Effect.runPromise(Fiber.join(fiber))).resolves.toEqual({ shapes: [] });
    await expect(Effect.runPromise(broker.complete("/workspace/a", "request-1", { ok: true }))).resolves.toBe(false);
  });

  it("times out and rejects late results", async () => {
    const broker = makeLatticeCanvasBroker({ randomId: () => "request-2", toolTimeoutMs: 5 });
    await expect(Effect.runPromise(broker.invoke("/workspace/a", "delete", { ids: [] }))).rejects.toMatchObject({
      code: "canvas_tool_timeout",
    });
    await expect(Effect.runPromise(broker.complete("/workspace/a", "request-2", { ok: true }))).resolves.toBe(false);
  });

  it("does not deliver or complete requests across workspaces", async () => {
    const broker = makeLatticeCanvasBroker({ randomId: () => "request-3", toolTimeoutMs: 1_000, pollTimeoutMs: 5 });
    const fiber = Effect.runFork(broker.invoke("/workspace/a", "list", {}));
    await expect(Effect.runPromise(broker.poll("/workspace/b"))).resolves.toBeNull();
    await expect(Effect.runPromise(broker.complete("/workspace/b", "request-3", { ok: true }))).resolves.toBe(false);
    await expect(Effect.runPromise(broker.poll("/workspace/a"))).resolves.toMatchObject({ id: "request-3" });
    await expect(Effect.runPromise(broker.complete("/workspace/a", "request-3", { ok: true }))).resolves.toBe(true);
    await expect(Effect.runPromise(Fiber.join(fiber))).resolves.toBeUndefined();
  });

  it("removes an interrupted tool request before a host can claim it", async () => {
    const broker = makeLatticeCanvasBroker({ randomId: () => "request-4", toolTimeoutMs: 1_000, pollTimeoutMs: 5 });
    const fiber = Effect.runFork(broker.invoke("/workspace/a", "create", { shapes: [] }));
    await Effect.runPromise(Fiber.interrupt(fiber));
    await expect(Effect.runPromise(broker.poll("/workspace/a"))).resolves.toBeNull();
    await expect(Effect.runPromise(broker.complete("/workspace/a", "request-4", { ok: true }))).resolves.toBe(false);
  });
});

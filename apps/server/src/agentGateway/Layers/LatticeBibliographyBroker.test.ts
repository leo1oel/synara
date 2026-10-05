import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";

import { makeLatticeBibliographyBroker } from "./LatticeBibliographyBroker.ts";

describe("LatticeBibliographyBroker", () => {
  it("correlates one trusted host result with the waiting mutation", async () => {
    const broker = makeLatticeBibliographyBroker({
      randomId: () => "bibliography-request-1",
      toolTimeoutMs: 1_000,
    });
    const fiber = Effect.runFork(
      broker.invoke("/workspace/a", "cite", { query: "Attention Is All You Need" }),
    );

    await expect(Effect.runPromise(broker.poll("/workspace/a"))).resolves.toMatchObject({
      id: "bibliography-request-1",
      action: "cite",
      params: { query: "Attention Is All You Need" },
    });
    await expect(
      Effect.runPromise(
        broker.complete("/workspace/a", "bibliography-request-1", {
          ok: true,
          result: { citationKey: "vaswani2017attention" },
        }),
      ),
    ).resolves.toBe(true);
    await expect(Effect.runPromise(Fiber.join(fiber))).resolves.toEqual({
      citationKey: "vaswani2017attention",
    });
  });

  it("isolates projects and rejects results after timeout", async () => {
    const broker = makeLatticeBibliographyBroker({
      randomId: () => "bibliography-request-2",
      toolTimeoutMs: 5,
      pollTimeoutMs: 5,
    });
    const fiber = Effect.runFork(
      broker.invoke("/workspace/a", "remove_reference", { key: "incorrect2024" }),
    );
    await expect(Effect.runPromise(broker.poll("/workspace/b"))).resolves.toBeNull();
    await expect(Effect.runPromise(Fiber.join(fiber))).rejects.toMatchObject({
      code: "bibliography_tool_timeout",
    });
    await expect(
      Effect.runPromise(
        broker.complete("/workspace/a", "bibliography-request-2", {
          ok: true,
          result: { removed: true },
        }),
      ),
    ).resolves.toBe(false);
  });
});

import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";

import { makeLatticeProjectDocumentBroker } from "./LatticeProjectDocumentBroker.ts";

describe("LatticeProjectDocumentBroker", () => {
  it("correlates one host result with the waiting create call", async () => {
    const broker = makeLatticeProjectDocumentBroker({
      randomId: () => "document-request-1",
      toolTimeoutMs: 1_000,
    });
    const fiber = Effect.runFork(
      broker.invoke("/workspace/a", {
        path: "boards/plan.tldr",
        documentType: "board",
      }),
    );

    await expect(Effect.runPromise(broker.poll("/workspace/a"))).resolves.toMatchObject({
      id: "document-request-1",
      args: { path: "boards/plan.tldr", documentType: "board" },
    });
    await expect(
      Effect.runPromise(
        broker.complete("/workspace/a", "document-request-1", {
          ok: true,
          result: { path: "boards/plan.tldr", documentType: "board", opened: true },
        }),
      ),
    ).resolves.toBe(true);
    await expect(Effect.runPromise(Fiber.join(fiber))).resolves.toEqual({
      path: "boards/plan.tldr",
      documentType: "board",
      opened: true,
    });
    await expect(
      Effect.runPromise(broker.complete("/workspace/a", "document-request-1", { ok: true })),
    ).resolves.toBe(false);
  });

  it("removes timed-out requests and isolates workspace roots", async () => {
    const broker = makeLatticeProjectDocumentBroker({
      randomId: () => "document-request-2",
      toolTimeoutMs: 5,
      pollTimeoutMs: 5,
    });
    const fiber = Effect.runFork(
      broker.invoke("/workspace/a", {
        path: "tables/data.lattice-sheet",
        documentType: "spreadsheet",
      }),
    );
    await expect(Effect.runPromise(broker.poll("/workspace/b"))).resolves.toBeNull();
    await expect(Effect.runPromise(Fiber.join(fiber))).rejects.toMatchObject({
      code: "project_document_tool_timeout",
    });
    await expect(Effect.runPromise(broker.poll("/workspace/a"))).resolves.toBeNull();
  });
});

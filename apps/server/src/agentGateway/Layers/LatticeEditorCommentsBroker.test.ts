import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { makeLatticeEditorCommentsBroker } from "./LatticeEditorCommentsBroker.ts";

describe("LatticeEditorCommentsBroker", () => {
  it("isolates workspaces, rejects mismatched completion, and expires queued calls", async () => {
    const broker = makeLatticeEditorCommentsBroker({
      randomId: () => "comments-1",
      toolTimeoutMs: 10,
      pollTimeoutMs: 2,
    });
    const fiber = Effect.runFork(broker.invoke("/a", {}));
    await expect(Effect.runPromise(broker.poll("/b"))).resolves.toBeNull();
    await expect(
      Effect.runPromise(broker.complete("/b", "comments-1", { ok: true, result: {} })),
    ).resolves.toBe(false);
    await expect(Effect.runPromise(Fiber.join(fiber))).rejects.toMatchObject({
      code: "editor_comments_tool_timeout",
    });
    await expect(Effect.runPromise(broker.poll("/a"))).resolves.toBeNull();
  });

  it("propagates host result errors", async () => {
    const broker = makeLatticeEditorCommentsBroker({
      randomId: () => "comments-2",
      toolTimeoutMs: 1_000,
    });
    const fiber = Effect.runFork(broker.invoke("/a", {}));
    await Effect.runPromise(broker.poll("/a"));
    await Effect.runPromise(
      broker.complete("/a", "comments-2", {
        ok: false,
        error: { code: "host_failed", message: "No comments" },
      }),
    );
    await expect(Effect.runPromise(Fiber.join(fiber))).rejects.toMatchObject({
      code: "host_failed",
      message: "No comments",
    });
  });
});

import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { makeLatticeEditorCommentsBroker } from "./LatticeEditorCommentsBroker.ts";
import { makeLatticeHostToolQueue } from "./LatticeHostToolQueue.ts";

describe("LatticeEditorCommentsBroker", () => {
  it("isolates workspaces, rejects mismatched completion, and expires queued calls", async () => {
    const hostTools = makeLatticeHostToolQueue({ pollTimeoutMs: 2 });
    const broker = makeLatticeEditorCommentsBroker(hostTools, {
      randomId: () => "comments-1",
      toolTimeoutMs: 10,
    });
    const fiber = Effect.runFork(broker.invoke("/a", {}));
    await expect(Effect.runPromise(hostTools.poll("/b"))).resolves.toBeNull();
    await expect(
      Effect.runPromise(broker.complete("/b", "comments-1", { ok: true, result: {} })),
    ).resolves.toBe(false);
    await expect(Effect.runPromise(Fiber.join(fiber))).rejects.toMatchObject({
      code: "editor_comments_tool_timeout",
    });
    await expect(Effect.runPromise(hostTools.poll("/a"))).resolves.toBeNull();
  });

  it("propagates host result errors", async () => {
    const hostTools = makeLatticeHostToolQueue();
    const broker = makeLatticeEditorCommentsBroker(hostTools, {
      randomId: () => "comments-2",
      toolTimeoutMs: 1_000,
    });
    const fiber = Effect.runFork(broker.invoke("/a", {}));
    await Effect.runPromise(hostTools.poll("/a"));
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

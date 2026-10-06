import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  LatticeEditorCommentsBroker,
  type LatticeEditorCommentsBrokerShape,
} from "./Services/LatticeEditorCommentsBroker.ts";
import { makeLatticeEditorCommentsTools } from "./latticeEditorCommentsTools.ts";
import type { ToolContext } from "./toolRuntime.ts";

const context = {
  principal: {
    kind: "provider-session",
    sessionKey: "s",
    threadId: "t",
    provider: "codex",
    turnId: "turn",
  },
  callerThreadId: "t",
  callerThreadLabel: "t",
  callerSessionKey: "s",
  callerProvider: "codex",
  callerCapabilities: new Set(["thread:read"]),
  callerTurnId: "turn",
  assertCallerTurnActive: () => Effect.void,
  jsonRpcRequestId: "r",
} as ToolContext;

describe("Lattice editor comments tool", () => {
  it("normalizes valid args and returns invalid arguments as a tool error", async () => {
    const calls: unknown[] = [];
    const broker: LatticeEditorCommentsBrokerShape = {
      invoke: (_root, args) => Effect.sync(() => (calls.push(args), { ok: true })),
      poll: () => Effect.succeed(null),
      complete: () => Effect.succeed(false),
    };
    const [tool] = await Effect.runPromise(
      makeLatticeEditorCommentsTools({
        resolveWorkspaceRoot: () => Effect.succeed("/workspace"),
      }).pipe(Effect.provideService(LatticeEditorCommentsBroker, broker)),
    );
    await Effect.runPromise(tool!.handler({ path: "main.tex" }, context));
    expect(calls).toEqual([{ path: "main.tex", includeResolved: false, offset: 0, limit: 50 }]);
    const invalid = await Effect.runPromise(tool!.handler({ path: "../secret" }, context));
    expect(invalid.isError).toBe(true);
    const content = invalid.content[0]!;
    expect(content.type).toBe("text");
    if (content.type !== "text") throw new Error("Expected text tool result");
    expect(JSON.parse(content.text)).toMatchObject({
      error: { code: "editor_comments_invalid_input" },
    });
    expect(calls).toHaveLength(1);
  });
});

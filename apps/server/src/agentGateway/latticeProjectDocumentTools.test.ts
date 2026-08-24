import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  LatticeProjectDocumentBroker,
  type LatticeProjectDocumentBrokerShape,
} from "./Services/LatticeProjectDocumentBroker.ts";
import { makeLatticeProjectDocumentTools } from "./latticeProjectDocumentTools.ts";
import type { ToolContext } from "./toolRuntime.ts";

const context: ToolContext = {
  principal: {
    kind: "provider-session",
    sessionKey: "session",
    threadId: "thread",
    provider: "codex",
    turnId: "turn",
  },
  callerThreadId: "thread",
  callerSessionKey: "session",
  callerProvider: "codex",
  callerCapabilities: new Set(["thread:read", "thread:write"]),
  callerTurnId: "turn",
  assertCallerTurnActive: () => Effect.void,
  jsonRpcRequestId: "request",
};

async function makeHarness() {
  const calls: Array<{
    readonly workspaceRoot: string;
    readonly args: { readonly path: string; readonly documentType: string };
  }> = [];
  const broker: LatticeProjectDocumentBrokerShape = {
    invoke: (workspaceRoot, args) =>
      Effect.sync(() => {
        calls.push({ workspaceRoot, args });
        return { path: args.path, documentType: args.documentType, opened: true };
      }),
    poll: () => Effect.succeed(null),
    complete: () => Effect.succeed(false),
  };
  const tools = await Effect.runPromise(
    makeLatticeProjectDocumentTools({
      resolveWorkspaceRoot: () => Effect.succeed("/workspace/project"),
    }).pipe(Effect.provideService(LatticeProjectDocumentBroker, broker)),
  );
  return { calls, create: tools[0]! };
}

function errorCode(result: unknown) {
  const toolResult = result as { content: Array<{ text: string }>; isError?: boolean };
  return {
    isError: toolResult.isError,
    code: (JSON.parse(toolResult.content[0]!.text) as { error: { code: string } }).error.code,
  };
}

describe("Lattice project document tool", () => {
  it("adds the native extension and forwards creation to the active workspace", async () => {
    const { calls, create } = await makeHarness();
    const boardResult = await Effect.runPromise(
      create.handler({ path: "boards/research-plan", documentType: "board" }, context),
    );
    const spreadsheetResult = await Effect.runPromise(
      create.handler({ path: "tables.v2/results", documentType: "spreadsheet" }, context),
    );

    expect(boardResult.isError).not.toBe(true);
    expect(spreadsheetResult.isError).not.toBe(true);
    expect(calls).toEqual([
      {
        workspaceRoot: "/workspace/project",
        args: { path: "boards/research-plan.tldr", documentType: "board" },
      },
      {
        workspaceRoot: "/workspace/project",
        args: { path: "tables.v2/results.lattice-sheet", documentType: "spreadsheet" },
      },
    ]);
    expect(create.requiredCapability).toBe("thread:write");
    expect(create.requiresActiveTurn).toBe(true);
    expect(create.definition.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
  });

  it("rejects traversal, absolute paths, and mismatched native extensions", async () => {
    const { calls, create } = await makeHarness();
    for (const args of [
      { path: "../outside", documentType: "board" },
      { path: "/tmp/board", documentType: "board" },
      { path: "board.lattice-sheet", documentType: "board" },
      { path: "table.tldr", documentType: "spreadsheet" },
    ]) {
      expect(errorCode(await Effect.runPromise(create.handler(args, context)))).toEqual({
        isError: true,
        code: "project_document_invalid_input",
      });
    }
    expect(calls).toHaveLength(0);
  });
});

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  LatticeSpreadsheetBroker,
  type LatticeSpreadsheetBrokerShape,
} from "./Services/LatticeSpreadsheetBroker.ts";
import { makeLatticeSpreadsheetTools } from "./latticeSpreadsheetTools.ts";
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
    readonly action: string;
    readonly args: Record<string, unknown>;
  }> = [];
  const broker: LatticeSpreadsheetBrokerShape = {
    invoke: (workspaceRoot, action, args) =>
      Effect.sync(() => {
        calls.push({ workspaceRoot, action, args });
        return { forwarded: action };
      }),
    poll: () => Effect.succeed(null),
    complete: () => Effect.succeed(false),
  };
  const tools = await Effect.runPromise(
    makeLatticeSpreadsheetTools({
      resolveWorkspaceRoot: () => Effect.succeed("/workspace/project"),
    }).pipe(Effect.provideService(LatticeSpreadsheetBroker, broker)),
  );
  return { calls, tools };
}

function errorCode(
  result: Awaited<ReturnType<(typeof context)["assertCallerTurnActive"]>> | unknown,
) {
  const toolResult = result as { content: Array<{ text: string }>; isError?: boolean };
  return {
    isError: toolResult.isError,
    code: (JSON.parse(toolResult.content[0]!.text) as { error: { code: string } }).error.code,
  };
}

describe("Lattice spreadsheet tools", () => {
  it("defaults read facets and forwards normalized A1 input to the active workspace", async () => {
    const { calls, tools } = await makeHarness();
    const read = tools.find((tool) => tool.definition.name === "spreadsheet_read")!;
    const result = await Effect.runPromise(
      read.handler(
        {
          path: "tables/results.lattice-sheet",
          sheet: " Results ",
          range: "$a$1:$b$2",
        },
        context,
      ),
    );

    expect(result.isError).not.toBe(true);
    expect(calls).toEqual([
      {
        workspaceRoot: "/workspace/project",
        action: "read",
        args: {
          path: "tables/results.lattice-sheet",
          sheet: "Results",
          range: "A1:B2",
          include: ["values", "formulas"],
        },
      },
    ]);
    expect(read.requiredCapability).toBe("thread:read");
    expect(read.definition.annotations?.readOnlyHint).toBe(true);
  });

  it("forwards every supported operation as one versioned atomic batch", async () => {
    const { calls, tools } = await makeHarness();
    const update = tools.find((tool) => tool.definition.name === "spreadsheet_batch_update")!;
    const result = await Effect.runPromise(
      update.handler(
        {
          path: "tables/results.lattice-sheet",
          operations: [
            { type: "set_values", sheet: "Data", range: "a1:b1", values: [[1, "two"]] },
            { type: "set_formulas", sheet: "Data", range: "C1", formulas: [["=A1"]] },
            { type: "clear", sheet: "Data", range: "D1:E2" },
            {
              type: "format_range",
              sheet: "Data",
              range: "A1:C1",
              format: { bold: true, backgroundColor: "#ffffff", horizontalAlignment: "center" },
            },
            { type: "insert_rows", sheet: "Data", before: 2, count: 3 },
            { type: "delete_rows", sheet: "Data", start: 20, count: 2 },
            { type: "insert_columns", sheet: "Data", before: "d", count: 1 },
            { type: "delete_columns", sheet: "Data", start: "f", count: 2 },
            { type: "add_sheet", name: "Summary", after: "Data" },
            { type: "rename_sheet", sheet: "Summary", name: "Overview" },
            { type: "delete_sheet", sheet: "Old" },
          ],
        },
        context,
      ),
    );

    expect(result.isError).not.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      workspaceRoot: "/workspace/project",
      action: "batch_update",
      args: {
        version: 1,
        path: "tables/results.lattice-sheet",
        operations: [
          { type: "set_values", range: "A1:B1" },
          { type: "set_formulas", range: "C1" },
          { type: "clear", include: ["values", "formulas", "formats"] },
          { type: "format_range" },
          { type: "insert_rows" },
          { type: "delete_rows" },
          { type: "insert_columns", before: "D" },
          { type: "delete_columns", start: "F" },
          { type: "add_sheet" },
          { type: "rename_sheet" },
          { type: "delete_sheet" },
        ],
      },
    });
    expect(update.requiredCapability).toBe("thread:write");
    expect(update.requiresActiveTurn).toBe(true);
    expect(update.definition.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(JSON.stringify(update.definition.inputSchema)).not.toMatch(/command.?id/iu);
  });

  it("rejects invalid paths, ranges, operation shapes, dimensions, and batch bounds", async () => {
    const { calls, tools } = await makeHarness();
    const read = tools.find((tool) => tool.definition.name === "spreadsheet_read")!;
    const update = tools.find((tool) => tool.definition.name === "spreadsheet_batch_update")!;
    const invalidCalls = [
      read.handler({ path: "../outside.lattice-sheet", range: "A1" }, context),
      read.handler({ path: "data.csv", range: "A1" }, context),
      read.handler({ path: "data.lattice-sheet", range: "A0" }, context),
      read.handler({ path: "data.lattice-sheet", range: "A1:XFD1048576" }, context),
      update.handler({ path: "data.lattice-sheet", operations: [] }, context),
      update.handler(
        {
          version: 2,
          path: "data.lattice-sheet",
          operations: [{ type: "clear", range: "A1" }],
        },
        context,
      ),
      update.handler(
        {
          path: "data.lattice-sheet",
          operations: [{ type: "set_values", range: "A1:B2", values: [[1, 2]] }],
        },
        context,
      ),
      update.handler(
        {
          path: "data.lattice-sheet",
          operations: [{ type: "set_formulas", range: "A1", formulas: [["SUM(B1:B2)"]] }],
        },
        context,
      ),
      update.handler(
        {
          path: "data.lattice-sheet",
          operations: [{ type: "format_range", range: "A1", format: { commandId: "internal" } }],
        },
        context,
      ),
      update.handler(
        {
          path: "data.lattice-sheet",
          operations: [{ type: "execute_command", commandId: "sheet.command" }],
        },
        context,
      ),
      update.handler(
        {
          path: "data.lattice-sheet",
          operations: Array.from({ length: 101 }, () => ({ type: "clear", range: "A1" })),
        },
        context,
      ),
    ];
    for (const invalidCall of invalidCalls) {
      expect(errorCode(await Effect.runPromise(invalidCall))).toEqual({
        isError: true,
        code: "spreadsheet_invalid_input",
      });
    }
    expect(calls).toHaveLength(0);
  });
});

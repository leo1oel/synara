import type { ExtensionAPI, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
  makePiApprovalGate,
  type PiApprovalRequestOpened,
  type PiApprovalRequestResolved,
} from "./piApprovalGate.ts";

type ToolCallHandler = (
  event: { toolName: string; toolCallId: string; input: Record<string, unknown> },
  ctx: { signal: AbortSignal | undefined },
) => Promise<ToolCallEventResult | undefined>;

function installGate() {
  const gate = makePiApprovalGate();
  let handler: ToolCallHandler | undefined;
  const pi = {
    on: (event: string, next: ToolCallHandler) => {
      expect(event).toBe("tool_call");
      handler = next;
      return () => undefined;
    },
  } as unknown as ExtensionAPI;
  if (typeof gate.extension === "function") throw new Error("expected a named inline extension");
  void gate.extension.factory(pi);
  const opened: PiApprovalRequestOpened[] = [];
  const resolved: PiApprovalRequestResolved[] = [];
  const call = (
    toolName: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolCallEventResult | undefined> =>
    handler!({ toolName, toolCallId: `${toolName}-${opened.length}`, input }, { signal });
  return { gate, opened, resolved, call };
}

describe("makePiApprovalGate", () => {
  it("lets read-only tools through without asking", async () => {
    const { gate, opened, call } = installGate();
    gate.bind({ opened: (request) => opened.push(request), resolved: () => undefined });
    await expect(call("read", { path: "main.tex" })).resolves.toBeUndefined();
    expect(opened).toEqual([]);
  });

  it("blocks a gated tool when no session is bound yet", async () => {
    const { call } = installGate();
    await expect(call("bash", { command: "ls" })).resolves.toMatchObject({ block: true });
  });

  it("remembers allow-for-session for the same command only", async () => {
    const { gate, opened, resolved, call } = installGate();
    gate.bind({
      opened: (request) => opened.push(request),
      resolved: (request) => resolved.push(request),
    });

    const first = call("bash", { command: "latexmk main.tex" });
    expect(opened[0]).toMatchObject({
      requestType: "command_execution_approval",
      detail: "latexmk main.tex",
    });
    expect(gate.respond(opened[0]!.requestId, "acceptForSession")).toBe(true);
    await expect(first).resolves.toBeUndefined();
    expect(resolved[0]).toMatchObject({ decision: "acceptForSession" });

    await expect(call("bash", { command: "latexmk main.tex" })).resolves.toBeUndefined();
    expect(opened).toHaveLength(1);

    const other = call("bash", { command: "rm -rf build" });
    expect(opened).toHaveLength(2);
    gate.respond(opened[1]!.requestId, "decline");
    await expect(other).resolves.toMatchObject({ block: true });
  });

  it("cancels pending requests when the session stops or the turn aborts", async () => {
    const { gate, opened, resolved, call } = installGate();
    gate.bind({
      opened: (request) => opened.push(request),
      resolved: (request) => resolved.push(request),
    });

    const stopped = call("edit", { path: "main.tex", edits: [] });
    gate.cancelAll();
    await expect(stopped).resolves.toMatchObject({
      block: true,
      reason: expect.stringContaining("cancelled"),
    });

    const controller = new AbortController();
    const aborted = call("write", { path: "notes.txt", content: "x" }, controller.signal);
    controller.abort();
    await expect(aborted).resolves.toMatchObject({ block: true });
    expect(resolved.map((request) => request.decision)).toEqual(["cancel", "cancel"]);
    expect(gate.respond(opened[1]!.requestId, "accept")).toBe(false);
  });
});

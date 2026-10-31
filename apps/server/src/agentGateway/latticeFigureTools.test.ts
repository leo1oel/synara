import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  LatticePresentationBroker,
  type LatticePresentationBrokerShape,
} from "./Services/LatticePresentationBroker.ts";
import { makeLatticeFigureTools } from "./latticeFigureTools.ts";
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

const TIKZ = "\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}";

async function figureTool(answer: () => unknown) {
  const calls: Array<{ root: string; action: string; args: Record<string, unknown> }> = [];
  const broker: LatticePresentationBrokerShape = {
    invoke: (root, action, args) =>
      Effect.sync(() => (calls.push({ root, action, args }), answer())),
    complete: () => Effect.succeed(false),
  };
  const [tool] = await Effect.runPromise(
    makeLatticeFigureTools({ resolveWorkspaceRoot: () => Effect.succeed("/workspace") }).pipe(
      Effect.provideService(LatticePresentationBroker, broker),
    ),
  );
  return { tool: tool!, calls };
}

describe("Lattice figure preview tool", () => {
  it("relays the figure to the host and returns its image as image content", async () => {
    const { tool, calls } = await figureTool(() => ({
      engine: "pdflatex",
      preambleToAdd: ["\\usetikzlibrary{calc}"],
      figure: "\\begin{figure}[t]\n...",
      image: { mimeType: "image/png", width: 900, height: 300, data: "iVBORw0KGgo=" },
    }));
    expect(tool.definition.name).toBe("preview_latex_figure");
    const result = await Effect.runPromise(
      tool.handler({ code: TIKZ, caption: "Loss.", label: "fig:loss", wide: true }, context),
    );
    expect(calls).toEqual([
      {
        root: "/workspace",
        action: "preview_figure",
        args: { code: TIKZ, wide: true, caption: "Loss.", label: "fig:loss" },
      },
    ]);
    expect(result.isError).toBeUndefined();
    const [text, image] = result.content;
    expect(image).toEqual({ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" });
    if (text?.type !== "text") throw new Error("Expected the metadata as text");
    const metadata = JSON.parse(text.text);
    expect(metadata.image).toEqual({ mimeType: "image/png", width: 900, height: 300 });
    expect(metadata.preambleToAdd).toEqual(["\\usetikzlibrary{calc}"]);
  });

  it("refuses invalid arguments without asking the host", async () => {
    const { tool, calls } = await figureTool(() => ({}));
    for (const args of [
      { code: " " },
      { code: TIKZ, label: "fig loss" },
      { code: TIKZ, shell: true },
    ]) {
      const result = await Effect.runPromise(tool.handler(args, context));
      expect(result.isError).toBe(true);
      const content = result.content[0]!;
      if (content.type !== "text") throw new Error("Expected text tool result");
      expect(JSON.parse(content.text)).toMatchObject({ error: { code: "figure_invalid_input" } });
    }
    expect(calls).toHaveLength(0);
  });
});

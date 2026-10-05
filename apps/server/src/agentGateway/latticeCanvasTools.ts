import { Effect } from "effect";

import { LatticeCanvasBroker, LatticeCanvasBrokerError } from "./Services/LatticeCanvasBroker.ts";
import { mcpToolResultError, mcpToolResultJson } from "./protocol.ts";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  WRITE_TOOL_ANNOTATIONS,
  type ToolEntry,
} from "./toolRuntime.ts";

const commonShapeProperties = {
  id: { type: "string", description: "Stable shape id in the form shape:name." },
  x: { type: "number", description: "Canvas x coordinate." },
  y: { type: "number", description: "Canvas y coordinate." },
  rotation: { type: "number", description: "Rotation in radians." },
  opacity: { type: "number", minimum: 0, maximum: 1 },
  isLocked: { type: "boolean" },
  width: { type: "number", description: "Convenience alias for props.w." },
  height: { type: "number", description: "Convenience alias for props.h." },
  text: { type: "string", description: "Plain text for text, note, or geometric shapes." },
  color: { type: "string", description: "A tldraw color such as black, blue, red, or green." },
  fill: { type: "string", description: "A tldraw fill such as none, semi, solid, or pattern." },
} as const;

const createShapesSchema = {
  type: "array",
  maxItems: 100,
  items: {
    type: "object",
    properties: {
      ...commonShapeProperties,
      type: {
        type: "string",
        enum: [
          "rectangle",
          "ellipse",
          "diamond",
          "triangle",
          "trapezoid",
          "hexagon",
          "oval",
          "rhombus",
          "geo",
          "text",
          "note",
          "arrow",
          "line",
          "draw",
          "frame",
          "highlight",
        ],
        description:
          "The model-friendly shape type. Geometric aliases are converted to tldraw geo shapes.",
      },
    },
    required: ["type"],
    additionalProperties: false,
  },
} as const;

const updateShapesSchema = {
  type: "array",
  maxItems: 100,
  items: {
    type: "object",
    properties: commonShapeProperties,
    required: ["id"],
    additionalProperties: false,
  },
} as const;

export const makeLatticeCanvasTools = (options: {
  readonly resolveWorkspaceRoot: (
    context: import("./toolRuntime.ts").ToolContext,
  ) => Effect.Effect<string | null>;
}) =>
  Effect.gen(function* () {
    const broker = yield* LatticeCanvasBroker;
    const makeTool = (input: {
      name: string;
      action: "list" | "create" | "update" | "delete";
      description: string;
      inputSchema: Record<string, unknown>;
      write: boolean;
    }): ToolEntry => ({
      requiredCapability: input.write ? "thread:write" : "thread:read",
      ...(input.write ? { requiresActiveTurn: true } : {}),
      definition: {
        name: input.name,
        description: input.description,
        inputSchema: input.inputSchema,
        annotations: input.write ? WRITE_TOOL_ANNOTATIONS : READ_ONLY_TOOL_ANNOTATIONS,
      },
      handler: (args, context) =>
        options.resolveWorkspaceRoot(context).pipe(
          Effect.flatMap((workspaceRoot) =>
            workspaceRoot
              ? broker.invoke(workspaceRoot, input.action, args)
              : Effect.fail(
                  new LatticeCanvasBrokerError(
                    "canvas_workspace_unavailable",
                    "The caller thread has no Lattice workspace.",
                  ),
                ),
          ),
          Effect.map(mcpToolResultJson),
          Effect.catch((error) =>
            Effect.succeed(
              mcpToolResultError(
                JSON.stringify({ error: { code: error.code, message: error.message } }),
              ),
            ),
          ),
        ),
    });

    return [
      makeTool({
        name: "list_canvas_shapes",
        action: "list",
        description:
          "List a page of shapes on the currently open Lattice tldraw page, including ids, positions, types, and properties. Use offset to continue when hasMore is true.",
        inputSchema: {
          type: "object",
          properties: {
            offset: { type: "integer", minimum: 0 },
            limit: { type: "integer", minimum: 1, maximum: 20 },
          },
          additionalProperties: false,
        },
        write: false,
      }),
      makeTool({
        name: "create_canvas_shapes",
        action: "create",
        description:
          "Create up to 100 shapes on the currently open Lattice tldraw canvas. Supports geometric aliases, text, notes, arrows, lines, drawings, frames, and highlights. Returns the complete created shapes and their stable ids.",
        inputSchema: {
          type: "object",
          properties: { shapes: createShapesSchema },
          required: ["shapes"],
          additionalProperties: false,
        },
        write: true,
      }),
      makeTool({
        name: "update_canvas_shapes",
        action: "update",
        description:
          "Move, resize, restyle, relabel, lock, or otherwise update up to 100 existing shapes on the currently open Lattice tldraw canvas. Call list_canvas_shapes first to obtain ids.",
        inputSchema: {
          type: "object",
          properties: { shapes: updateShapesSchema },
          required: ["shapes"],
          additionalProperties: false,
        },
        write: true,
      }),
      makeTool({
        name: "delete_canvas_shapes",
        action: "delete",
        description: "Delete up to 100 shapes from the live Lattice canvas.",
        inputSchema: {
          type: "object",
          properties: { ids: { type: "array", maxItems: 100, items: { type: "string" } } },
          required: ["ids"],
          additionalProperties: false,
        },
        write: true,
      }),
    ] satisfies ReadonlyArray<ToolEntry>;
  });

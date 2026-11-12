import { Effect } from "effect";
import {
  LatticeEditorCommentsBroker,
  LatticeEditorCommentsBrokerError,
  type LatticeEditorCommentsArgs,
} from "./Services/LatticeEditorCommentsBroker.ts";
import { mcpToolResultError, mcpToolResultJson } from "./protocol.ts";
import { READ_ONLY_TOOL_ANNOTATIONS, type ToolContext, type ToolEntry } from "./toolRuntime.ts";

function parseArgs(value: unknown): LatticeEditorCommentsArgs {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Arguments must be an object.");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !["path", "includeResolved", "offset", "limit"].includes(key))
  )
    throw new Error("Arguments contain an unknown property.");
  if (
    input.path !== undefined &&
    (typeof input.path !== "string" ||
      !input.path ||
      input.path.startsWith("/") ||
      /^[A-Za-z]:/.test(input.path) ||
      input.path.includes("\\") ||
      input.path.split("/").some((part) => !part || part === "." || part === ".."))
  )
    throw new Error("path must be a normalized project-relative path.");
  if (input.includeResolved !== undefined && typeof input.includeResolved !== "boolean")
    throw new Error("includeResolved must be boolean.");
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 50;
  if (!Number.isInteger(offset) || Number(offset) < 0)
    throw new Error("offset must be a nonnegative integer.");
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100)
    throw new Error("limit must be an integer from 1 to 100.");
  return {
    ...(input.path === undefined ? {} : { path: input.path as string }),
    includeResolved: input.includeResolved === true,
    offset: Number(offset),
    limit: Number(limit),
  };
}

export const makeLatticeEditorCommentsTools = (options: {
  resolveWorkspaceRoot: (context: ToolContext) => Effect.Effect<string | null>;
}) =>
  Effect.gen(function* () {
    const broker = yield* LatticeEditorCommentsBroker;
    const tool: ToolEntry = {
      requiredCapability: "thread:read",
      requiresActiveTurn: true,
      definition: {
        name: "read_editor_comments",
        description:
          "Read review comments across the active Lattice project. Use this when current-document context reports omitted comments or when the user asks about comments elsewhere in the project.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            includeResolved: { type: "boolean", default: false },
            offset: { type: "integer", minimum: 0, default: 0 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
          additionalProperties: false,
        },
        annotations: { title: "Read editor comments", ...READ_ONLY_TOOL_ANNOTATIONS },
      },
      handler: (args, context) =>
        Effect.gen(function* () {
          const parsed = yield* Effect.try({
            try: () => parseArgs(args),
            catch: (error) =>
              new LatticeEditorCommentsBrokerError(
                "editor_comments_invalid_input",
                error instanceof Error ? error.message : "Invalid editor comments request.",
              ),
          });
          const workspaceRoot = yield* options.resolveWorkspaceRoot(context);
          if (!workspaceRoot)
            return yield* Effect.fail(
              new LatticeEditorCommentsBrokerError(
                "editor_comments_workspace_unavailable",
                "The caller task has no Lattice workspace.",
              ),
            );
          return yield* broker.invoke(workspaceRoot, parsed);
        }).pipe(
          Effect.map(mcpToolResultJson),
          Effect.catch((error) =>
            Effect.succeed(
              mcpToolResultError(
                JSON.stringify({
                  error: {
                    code:
                      error instanceof LatticeEditorCommentsBrokerError
                        ? error.code
                        : "editor_comments_invalid_input",
                    message:
                      error instanceof Error ? error.message : "Invalid editor comments request.",
                  },
                }),
              ),
            ),
          ),
        ),
    };
    return [tool] satisfies ReadonlyArray<ToolEntry>;
  });

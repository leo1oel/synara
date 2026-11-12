import { Effect } from "effect";

import {
  LatticeProjectDocumentBroker,
  LatticeProjectDocumentBrokerError,
  type LatticeProjectDocumentRequest,
  type LatticeProjectDocumentType,
} from "./Services/LatticeProjectDocumentBroker.ts";
import { mcpToolResultError, mcpToolResultJson } from "./protocol.ts";
import { WRITE_TOOL_ANNOTATIONS, type ToolContext, type ToolEntry } from "./toolRuntime.ts";

class ProjectDocumentInputError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseProjectDocumentArgs(value: unknown): LatticeProjectDocumentRequest["args"] {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== "path" && key !== "documentType")
  ) {
    throw new ProjectDocumentInputError("Arguments must contain only path and documentType.");
  }
  const documentType = value.documentType;
  if (documentType !== "board" && documentType !== "spreadsheet") {
    throw new ProjectDocumentInputError("documentType must be board or spreadsheet.");
  }
  const requestedPath = typeof value.path === "string" ? value.path.trim() : "";
  if (
    !requestedPath ||
    requestedPath.length > 1_024 ||
    requestedPath.startsWith("/") ||
    /^[A-Za-z]:/.test(requestedPath) ||
    requestedPath.includes("\\") ||
    requestedPath.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new ProjectDocumentInputError("path must be a normalized workspace-relative path.");
  }
  const extension = documentType === "board" ? ".tldr" : ".lattice-sheet";
  const lowerPath = requestedPath.toLocaleLowerCase("en-US");
  const filename = requestedPath.split("/").at(-1) ?? "";
  const path = lowerPath.endsWith(extension)
    ? requestedPath
    : filename.includes(".")
      ? ""
      : `${requestedPath}${extension}`;
  if (!path) {
    throw new ProjectDocumentInputError(
      `${documentType} paths must use the ${extension} extension or omit an extension.`,
    );
  }
  return { path, documentType: documentType as LatticeProjectDocumentType };
}

function errorResult(error: unknown) {
  const normalized =
    error instanceof LatticeProjectDocumentBrokerError
      ? error
      : error instanceof ProjectDocumentInputError
        ? new LatticeProjectDocumentBrokerError("project_document_invalid_input", error.message)
        : new LatticeProjectDocumentBrokerError(
            "project_document_create_failed",
            error instanceof Error ? error.message : "The project document tool failed.",
          );
  return mcpToolResultError(
    JSON.stringify({ error: { code: normalized.code, message: normalized.message } }),
  );
}

export const makeLatticeProjectDocumentTools = (options: {
  readonly resolveWorkspaceRoot: (context: ToolContext) => Effect.Effect<string | null>;
}) =>
  Effect.gen(function* () {
    const broker = yield* LatticeProjectDocumentBroker;
    const createProjectDocument: ToolEntry = {
      requiredCapability: "thread:write",
      requiresActiveTurn: true,
      definition: {
        name: "create_project_document",
        description:
          "Create and open a new Lattice board or spreadsheet in the active project. The path may omit its extension; boards become .tldr and spreadsheets become .lattice-sheet. After creation, use create_canvas_shapes for a board or spreadsheet_batch_update for a spreadsheet.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              minLength: 1,
              maxLength: 1_024,
              description:
                "Workspace-relative destination path. Parent folders must already exist. The matching extension is optional.",
            },
            documentType: {
              type: "string",
              enum: ["board", "spreadsheet"],
            },
          },
          required: ["path", "documentType"],
          additionalProperties: false,
        },
        annotations: {
          title: "Create project document",
          ...WRITE_TOOL_ANNOTATIONS,
          destructiveHint: false,
        },
      },
      handler: (args, context) =>
        Effect.gen(function* () {
          const parsed = yield* Effect.try({
            try: () => parseProjectDocumentArgs(args),
            catch: (error) =>
              error instanceof ProjectDocumentInputError
                ? error
                : new ProjectDocumentInputError("Project document arguments are invalid."),
          });
          const workspaceRoot = yield* options.resolveWorkspaceRoot(context);
          if (!workspaceRoot) {
            return yield* Effect.fail(
              new LatticeProjectDocumentBrokerError(
                "project_document_workspace_unavailable",
                "The caller task has no Lattice workspace.",
              ),
            );
          }
          return yield* broker.invoke(workspaceRoot, parsed);
        }).pipe(
          Effect.map(mcpToolResultJson),
          Effect.catch((error) => Effect.succeed(errorResult(error))),
        ),
    };
    return [createProjectDocument] satisfies ReadonlyArray<ToolEntry>;
  });

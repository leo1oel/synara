import { Effect } from "effect";

import {
  LatticePresentationBroker,
  LatticePresentationBrokerError,
} from "./Services/LatticePresentationBroker.ts";
import { mcpToolResultError, type McpToolCallResult } from "./protocol.ts";
import { READ_ONLY_TOOL_ANNOTATIONS, type ToolContext, type ToolEntry } from "./toolRuntime.ts";

// Lattice typesets the figure in a scratch folder with the paper's preamble
// and answers over the presentation channel, which already carries a rendered
// page back as an image. The host bounds the code and checks the LaTeX; this
// side only shapes the arguments.
const MAX_CODE_LENGTH = 256 * 1024;
const MAX_PREAMBLE_LENGTH = 32 * 1024;
const MAX_CAPTION_LENGTH = 2_000;
const LABEL = "^[A-Za-z0-9][A-Za-z0-9:_./+-]{0,119}$";
const PLACEMENT = "^[htbpH!]{1,5}$";
const FIELDS = [
  "code",
  "preamble",
  "document",
  "lineWidth",
  "wide",
  "caption",
  "label",
  "placement",
] as const;

class FigureInputError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseFigureArgs(value: unknown): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !(FIELDS as ReadonlyArray<string>).includes(key))
  ) {
    throw new FigureInputError(`Arguments may contain only ${FIELDS.join(", ")}.`);
  }
  if (typeof value.code !== "string" || !value.code.trim() || value.code.length > MAX_CODE_LENGTH) {
    throw new FigureInputError("code must be the figure's LaTeX body, at most 256 KiB.");
  }
  const text = (field: string, maximum: number) => {
    const entry = value[field];
    if (entry !== undefined && (typeof entry !== "string" || entry.length > maximum)) {
      throw new FigureInputError(`${field} must be a string of at most ${maximum} characters.`);
    }
  };
  text("preamble", MAX_PREAMBLE_LENGTH);
  text("document", 1_024);
  text("lineWidth", 64);
  text("caption", MAX_CAPTION_LENGTH);
  if (
    value.label !== undefined &&
    (typeof value.label !== "string" || !new RegExp(LABEL).test(value.label))
  ) {
    throw new FigureInputError("label must be a LaTeX label such as fig:loss-curves.");
  }
  if (
    value.placement !== undefined &&
    (typeof value.placement !== "string" || !new RegExp(PLACEMENT).test(value.placement))
  ) {
    throw new FigureInputError("placement must be float placement letters such as t or htbp.");
  }
  if (value.wide !== undefined && typeof value.wide !== "boolean") {
    throw new FigureInputError("wide must be a boolean.");
  }
  return Object.fromEntries(
    FIELDS.flatMap((field) => (value[field] === undefined ? [] : [[field, value[field]]])),
  );
}

// The figure goes back as image content beside its metadata, so the model
// sees it without decoding anything.
function previewResult(value: unknown): McpToolCallResult {
  const image = isRecord(value) ? value.image : undefined;
  if (
    !isRecord(value) ||
    !isRecord(image) ||
    (image.mimeType !== "image/png" && image.mimeType !== "image/jpeg") ||
    typeof image.data !== "string" ||
    image.data.length === 0
  ) {
    throw new LatticePresentationBrokerError(
      "figure_host_invalid_result",
      "The Lattice host returned an invalid figure image.",
    );
  }
  const { data, ...imageMetadata } = image;
  const metadata = { ...value, image: imageMetadata };
  return {
    content: [
      { type: "text", text: JSON.stringify(metadata, null, 2) },
      { type: "image", data, mimeType: image.mimeType },
    ],
  };
}

function errorResult(error: unknown) {
  const normalized =
    error instanceof LatticePresentationBrokerError
      ? error
      : error instanceof FigureInputError
        ? new LatticePresentationBrokerError("figure_invalid_input", error.message)
        : new LatticePresentationBrokerError(
            "figure_preview_failed",
            error instanceof Error ? error.message : "The figure preview failed.",
          );
  return mcpToolResultError(
    JSON.stringify({ error: { code: normalized.code, message: normalized.message } }),
  );
}

export const makeLatticeFigureTools = (options: {
  readonly resolveWorkspaceRoot: (context: ToolContext) => Effect.Effect<string | null>;
}) =>
  Effect.gen(function* () {
    const broker = yield* LatticePresentationBroker;
    const previewLatexFigure: ToolEntry = {
      requiredCapability: "thread:read",
      definition: {
        name: "preview_latex_figure",
        description:
          "Typeset a LaTeX figure's body (a TikZ or PGFPlots picture, \\includegraphics, subfigures, a tabular) on its own and return it as an image, drawn as the paper will draw it: with the project document's own preamble (class, packages, macros, colours) at the paper's column width. It builds in an isolated scratch folder and never touches the project's files or its build outputs. Use it every time you draw or change a figure: look for overlapping or clipped labels, a legend over the data, unreadable text, a poor aspect ratio and anything wider than the column (listed in warnings), fix the code and preview again until it reads cleanly. A `figure_build_failed` error lists TeX's errors by code line. Then call it once more with caption and label: the result's `figure` is the figure environment to insert. Insert it with your ordinary file edit where the user asked, or else at the nearest paragraph break after the editor cursor in <lattice_active_context>, and add the result's preambleToAdd lines to that document's preamble. If preambleFallback is set, the paper's preamble could not be used here, so fonts and macros may differ from the paper.",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              minLength: 1,
              maxLength: MAX_CODE_LENGTH,
              description:
                "What goes inside the figure environment, without \\begin{figure}, \\caption or \\label: for example a tikzpicture.",
            },
            preamble: {
              type: "string",
              maxLength: MAX_PREAMBLE_LENGTH,
              description:
                "Preamble lines the figure needs beyond the document's own, such as \\usepackage{pgfplots} or \\usetikzlibrary{arrows.meta}.",
            },
            document: {
              type: "string",
              maxLength: 1_024,
              description:
                "Project-relative .tex document whose preamble to typeset with; defaults to the root document.",
            },
            lineWidth: {
              type: "string",
              maxLength: 64,
              description:
                "The width the figure is set in: \\columnwidth (the default), \\textwidth (the default when wide), a fraction such as 0.8\\columnwidth, or a length such as 3.25in.",
            },
            wide: {
              type: "boolean",
              description: "A figure* across both columns of a two-column paper.",
            },
            caption: {
              type: "string",
              maxLength: MAX_CAPTION_LENGTH,
              description:
                "The caption, in LaTeX. With label, the result includes the figure environment to insert.",
            },
            label: {
              type: "string",
              pattern: LABEL,
              description: "The figure's \\label, such as fig:loss-curves.",
            },
            placement: {
              type: "string",
              pattern: PLACEMENT,
              description: "Float placement for the inserted figure; t by default.",
            },
          },
          required: ["code"],
          additionalProperties: false,
        },
        annotations: { title: "Preview LaTeX figure", ...READ_ONLY_TOOL_ANNOTATIONS },
      },
      handler: (args, context) =>
        Effect.gen(function* () {
          const parsed = yield* Effect.try({
            try: () => parseFigureArgs(args),
            catch: (error) =>
              error instanceof FigureInputError
                ? error
                : new FigureInputError("Figure preview arguments are invalid."),
          });
          const workspaceRoot = yield* options.resolveWorkspaceRoot(context);
          if (!workspaceRoot) {
            return yield* Effect.fail(
              new LatticePresentationBrokerError(
                "figure_workspace_unavailable",
                "The caller task has no Lattice workspace.",
              ),
            );
          }
          const value = yield* broker.invoke(workspaceRoot, "preview_figure", parsed);
          return yield* Effect.try({
            try: () => previewResult(value),
            catch: (error) => error,
          });
        }).pipe(Effect.catch((error) => Effect.succeed(errorResult(error)))),
    };
    return [previewLatexFigure] satisfies ReadonlyArray<ToolEntry>;
  });

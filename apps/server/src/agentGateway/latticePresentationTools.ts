import { Effect } from "effect";

import {
  LatticePresentationBroker,
  LatticePresentationBrokerError,
} from "./Services/LatticePresentationBroker.ts";
import { mcpToolResultError, type McpToolCallResult } from "./protocol.ts";
import { READ_ONLY_TOOL_ANNOTATIONS, type ToolContext, type ToolEntry } from "./toolRuntime.ts";

const DECK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const MAX_PAGE = 10_000;

class PresentationInputError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const isCount = (value: unknown, minimum: number): value is number =>
  Number.isInteger(value) && (value as number) >= minimum && (value as number) <= MAX_PAGE;

function parsePreviewArgs(value: unknown): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !["deck", "page", "step"].includes(key))
  ) {
    throw new PresentationInputError("Arguments must contain only deck, page, and step.");
  }
  if (typeof value.deck !== "string" || !DECK_ID.test(value.deck)) {
    throw new PresentationInputError(
      "deck must be an Open Slide deck id, the <deck> in slides/<deck>/index.tsx.",
    );
  }
  if (!isCount(value.page, 1)) throw new PresentationInputError("page must be a 1-based integer.");
  if (value.step !== undefined && !isCount(value.step, 0)) {
    throw new PresentationInputError("step must be a non-negative integer.");
  }
  return {
    deck: value.deck,
    page: value.page,
    ...(value.step === undefined ? {} : { step: value.step }),
  };
}

// The host answers with the page as base64 JPEG beside its metadata. The image
// goes back as image content so the model sees the page without decoding it.
function previewResult(value: unknown): McpToolCallResult {
  const image = isRecord(value) ? value.image : undefined;
  if (
    !isRecord(value) ||
    !isRecord(image) ||
    image.mimeType !== "image/jpeg" ||
    typeof image.data !== "string" ||
    image.data.length === 0
  ) {
    throw new LatticePresentationBrokerError(
      "presentation_host_invalid_result",
      "The presentation host returned an invalid page image.",
    );
  }
  const { data, ...imageMetadata } = image;
  const metadata = { ...value, image: imageMetadata };
  return {
    content: [
      { type: "text", text: JSON.stringify(metadata, null, 2) },
      { type: "image", data, mimeType: "image/jpeg" },
    ],
  };
}

function errorResult(error: unknown) {
  const normalized =
    error instanceof LatticePresentationBrokerError
      ? error
      : error instanceof PresentationInputError
        ? new LatticePresentationBrokerError("presentation_invalid_input", error.message)
        : new LatticePresentationBrokerError(
            "presentation_preview_failed",
            error instanceof Error ? error.message : "The page preview failed.",
          );
  return mcpToolResultError(
    JSON.stringify({ error: { code: normalized.code, message: normalized.message } }),
  );
}

export const makeLatticePresentationTools = (options: {
  readonly resolveWorkspaceRoot: (context: ToolContext) => Effect.Effect<string | null>;
}) =>
  Effect.gen(function* () {
    const broker = yield* LatticePresentationBroker;
    const previewPresentationPage: ToolEntry = {
      requiredCapability: "thread:read",
      definition: {
        name: "preview_presentation_page",
        description:
          "Render one page of an Open Slide deck in the active Lattice project, as the files on disk now stand, and return it as a 1920 × 1080 image without editor chrome. Use it after creating or editing pages to check layout, overflow, wraps, colors, and images. It does not move the user's current page or selection.",
        inputSchema: {
          type: "object",
          properties: {
            deck: {
              type: "string",
              minLength: 1,
              maxLength: 200,
              description: "The deck id: the <deck> in slides/<deck>/index.tsx.",
            },
            page: {
              type: "integer",
              minimum: 1,
              maximum: MAX_PAGE,
              description: "The 1-based page number.",
            },
            step: {
              type: "integer",
              minimum: 0,
              maximum: MAX_PAGE,
              description:
                "Reveal only the first n Steps of a stepped page. Omit it to show the page fully revealed.",
            },
          },
          required: ["deck", "page"],
          additionalProperties: false,
        },
        annotations: { title: "Preview presentation page", ...READ_ONLY_TOOL_ANNOTATIONS },
      },
      handler: (args, context) =>
        Effect.gen(function* () {
          const parsed = yield* Effect.try({
            try: () => parsePreviewArgs(args),
            catch: (error) =>
              error instanceof PresentationInputError
                ? error
                : new PresentationInputError("Page preview arguments are invalid."),
          });
          const workspaceRoot = yield* options.resolveWorkspaceRoot(context);
          if (!workspaceRoot) {
            return yield* Effect.fail(
              new LatticePresentationBrokerError(
                "presentation_workspace_unavailable",
                "The caller task has no Lattice workspace.",
              ),
            );
          }
          const value = yield* broker.invoke(workspaceRoot, "preview_page", parsed);
          return yield* Effect.try({
            try: () => previewResult(value),
            catch: (error) => error,
          });
        }).pipe(Effect.catch((error) => Effect.succeed(errorResult(error)))),
    };
    return [previewPresentationPage] satisfies ReadonlyArray<ToolEntry>;
  });

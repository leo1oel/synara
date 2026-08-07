import { execFile } from "node:child_process";

import { Effect } from "effect";

import { mcpToolResultError, mcpToolResultJson, mcpToolResultText } from "./protocol.ts";
import { readBooleanArg, readStringArg } from "./toolInput.ts";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  WRITE_TOOL_ANNOTATIONS,
  type ToolContext,
  type ToolEntry,
} from "./toolRuntime.ts";

interface LatticeLiteratureToolsInput {
  readonly resolveWorkspaceRoot: (
    context: ToolContext,
  ) => Effect.Effect<string | null, unknown, never>;
}

function executeLatticeLiteratureTool(input: {
  readonly tool: string;
  readonly params: Record<string, unknown>;
  readonly workspaceRoot: string;
}): Effect.Effect<Record<string, unknown>, Error> {
  return Effect.tryPromise({
    try: (signal) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const binary = process.env.LATTICE_BIN;
        if (!binary) {
          reject(new Error("Lattice did not provide its executable path."));
          return;
        }
        const child = execFile(
          binary,
          ["literature", JSON.stringify({ tool: input.tool, params: input.params })],
          {
            cwd: input.workspaceRoot,
            env: {
              ...process.env,
              LATTICE_PROJECT_ROOT: input.workspaceRoot,
            },
            maxBuffer: 20 * 1024 * 1024,
          },
          (error, stdout, stderr) => {
            if (error) {
              reject(new Error(stderr.trim() || error.message));
              return;
            }
            try {
              const value: unknown = JSON.parse(stdout);
              if (value === null || typeof value !== "object" || Array.isArray(value)) {
                throw new Error("Lattice returned an invalid response.");
              }
              resolve(value as Record<string, unknown>);
            } catch (parseError) {
              reject(
                parseError instanceof Error
                  ? parseError
                  : new Error("Lattice returned invalid JSON."),
              );
            }
          },
        );
        signal.addEventListener("abort", () => child.kill(), { once: true });
      }),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });
}

export function makeLatticeLiteratureTools(
  input: LatticeLiteratureToolsInput,
): ReadonlyArray<ToolEntry> {
  const invoke = (tool: string, params: Record<string, unknown>, context: ToolContext) =>
    Effect.gen(function* () {
      const workspaceRoot = yield* input.resolveWorkspaceRoot(context);
      if (!workspaceRoot) {
        return mcpToolResultError("The active Lattice project has no writable workspace.");
      }
      const value = yield* executeLatticeLiteratureTool({ tool, params, workspaceRoot });
      if (tool !== "cite") return mcpToolResultJson(value);
      const key = typeof value.citationKey === "string" ? value.citationKey : null;
      if (!key) return mcpToolResultError("Lattice returned no citation key.");
      const title = typeof value.title === "string" ? value.title : key;
      const paperPath = typeof value.paperPath === "string" ? value.paperPath : null;
      return mcpToolResultText(
        `Cited "${title}" as \\cite{${key}}.${
          paperPath ? ` Full text: ${paperPath}` : " This work has no cached full text."
        }`,
      );
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          mcpToolResultError(
            `Lattice ${tool} failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ),
      ),
    );

  const searchLiterature: ToolEntry = {
    requiredCapability: "literature:read",
    definition: {
      name: "search_literature",
      description:
        "Search alphaXiv and OpenAlex for related academic works. Results are discovery metadata, not paper evidence, and this tool does not download or cite them.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Topic, title, author, or keywords." },
          precise: { type: "boolean", description: "Prefer a title-like search." },
          page: { type: "number", description: "Zero-based result page." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: {
        title: "Search literature",
        ...READ_ONLY_TOOL_ANNOTATIONS,
        openWorldHint: true,
      },
    },
    handler: (args, context) => {
      try {
        return invoke(
          "search_literature",
          {
            query: readStringArg(args, "query", { required: true })!,
            ...(readBooleanArg(args, "precise") === undefined
              ? {}
              : { precise: readBooleanArg(args, "precise") }),
            ...(typeof args.page === "number" ? { page: args.page } : {}),
          },
          context,
        );
      } catch (error) {
        return Effect.succeed(
          mcpToolResultError(error instanceof Error ? error.message : String(error)),
        );
      }
    },
  };

  const fetchPaper: ToolEntry = {
    requiredCapability: "literature:write",
    requiresActiveTurn: true,
    definition: {
      name: "fetch_paper",
      description:
        "Download and cache the complete text, overview, and metadata for an arXiv paper. When arXiv has no HTML rendering (mostly older papers), converts the PDF text layer instead; such files say so in their frontmatter and lack figures, so verify equations against the PDF before quoting them. Reuses an existing complete copy and does not add a citation.",
      inputSchema: {
        type: "object",
        properties: {
          arxivId: { type: "string", description: "An arXiv id or URL, optionally versioned." },
        },
        required: ["arxivId"],
        additionalProperties: false,
      },
      annotations: { title: "Fetch paper", ...WRITE_TOOL_ANNOTATIONS, openWorldHint: true },
    },
    handler: (args, context) =>
      invoke(
        "fetch_paper",
        { arxivId: readStringArg(args, "arxivId", { required: true })! },
        context,
      ),
  };

  const cite: ToolEntry = {
    requiredCapability: "literature:write",
    requiresActiveTurn: true,
    definition: {
      name: "cite",
      description:
        "Add a work to the bibliography and return the exact \\cite{...} key. Resolves current publication metadata, avoids duplicates, and captures full text locally: arXiv papers by id, webpages by URL. A failed download never blocks the citation; the result reports it as fetchError.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "An arXiv id, DOI, URL, or title." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { title: "Cite", ...WRITE_TOOL_ANNOTATIONS, openWorldHint: true },
    },
    handler: (args, context) =>
      invoke("cite", { query: readStringArg(args, "query", { required: true })! }, context),
  };

  const fetchWebReference: ToolEntry = {
    requiredCapability: "literature:write",
    requiresActiveTurn: true,
    definition: {
      name: "fetch_web_reference",
      description:
        "Capture a webpage or blog post as local markdown so it can be read like a paper. Reuses an existing capture of the same URL and does not add a citation (cite does both). Scraping spends a shared monthly quota; do not use it for arXiv papers, which fetch_paper handles locally.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The http(s) page to capture." },
        },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { title: "Capture webpage", ...WRITE_TOOL_ANNOTATIONS, openWorldHint: true },
    },
    handler: (args, context) =>
      invoke("fetch_web_reference", { url: readStringArg(args, "url", { required: true })! }, context),
  };

  const upgradeBibliography: ToolEntry = {
    requiredCapability: "literature:write",
    requiresActiveTurn: true,
    definition: {
      name: "upgrade_bibliography",
      description:
        "Find published versions of preprints in the bibliography and update them while preserving citation keys. Use dry-run mode to preview changes.",
      inputSchema: {
        type: "object",
        properties: {
          dryRun: { type: "boolean", description: "Preview without writing history or files." },
        },
        additionalProperties: false,
      },
      annotations: {
        title: "Upgrade bibliography",
        ...WRITE_TOOL_ANNOTATIONS,
        openWorldHint: true,
      },
    },
    handler: (args, context) =>
      invoke(
        "upgrade_bibliography",
        {
          ...(readBooleanArg(args, "dryRun") === undefined
            ? {}
            : { dryRun: readBooleanArg(args, "dryRun") }),
        },
        context,
      ),
  };

  const removeReference: ToolEntry = {
    requiredCapability: "literature:write",
    requiresActiveTurn: true,
    definition: {
      name: "remove_reference",
      description:
        "Remove one bibliography entry by citation key while keeping downloaded paper files. Fails when the manuscript still cites that key.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: "Citation key to remove." },
        },
        required: ["key"],
        additionalProperties: false,
      },
      annotations: { title: "Remove reference", ...WRITE_TOOL_ANNOTATIONS },
    },
    handler: (args, context) =>
      invoke("remove_reference", { key: readStringArg(args, "key", { required: true })! }, context),
  };

  return [searchLiterature, fetchPaper, cite, fetchWebReference, upgradeBibliography, removeReference];
}

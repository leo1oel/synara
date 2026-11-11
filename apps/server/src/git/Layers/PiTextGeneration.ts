import { Buffer } from "node:buffer";
import * as FS from "node:fs/promises";
import * as OS from "node:os";
import path from "node:path";

import { Effect, Layer, Option, Schema } from "effect";

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { PiModelSelection, ProviderStartOptions } from "@synara/contracts";
import { sanitizeGeneratedThreadTitle } from "@synara/shared/chatThreads";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@synara/shared/git";

import { ServerConfig } from "../../config.ts";
import {
  createPiModelRuntime,
  DEFAULT_PI_THINKING_LEVEL,
  loadPiCodingAgentModule,
  normalizePiThinkingLevel,
  resolvePiSessionModel,
} from "../../provider/Layers/PiAdapter.ts";
import { makePiStoragePaths } from "../../provider/piStoragePaths.ts";
import { TextGenerationError } from "../Errors.ts";
import {
  PiTextGeneration,
  TextGeneration,
  type TextGenerationShape,
  type TextGenerationOperation,
} from "../Services/TextGeneration.ts";
import {
  buildAutomationIntentPrompt,
  buildAutomationCompletionEvaluationPrompt,
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildDiffSummaryPrompt,
  buildTextTaskPrompt,
  buildPrContentPrompt,
  buildThreadRecapPrompt,
  buildProjectDigestPrompt,
  buildThreadTitlePrompt,
  decodeStructuredTextGenerationOutput,
  sanitizeCommitSubject,
  sanitizeDiffSummary,
  sanitizeThreadRecap,
  sanitizePrTitle,
  type RawTextFallback,
} from "../textGenerationShared.ts";
import {
  ACP_TEXT_GENERATION_MAX_OUTPUT_BYTES,
  isTextGenerationError,
} from "./AcpTextGeneration.ts";

const PI_TEXT_GENERATION_LABEL = "Pi";
const PI_TIMEOUT_MS = 180_000;

// Replaces Pi's coding-agent system prompt, which describes tools and a
// workspace this session does not have.
const PI_TEXT_GENERATION_SYSTEM_PROMPT =
  "You are a writing assistant. You have no tools and no files. Follow the user's instructions exactly and reply with text only.";

function resolvePiModelSelection(input: {
  readonly modelSelection?: {
    readonly provider: string;
    readonly model: string;
    readonly options?: unknown;
  };
}): PiModelSelection | null {
  return input.modelSelection?.provider === "pi"
    ? (input.modelSelection as PiModelSelection)
    : null;
}

interface PiTextPromptInput {
  readonly agentDir: string;
  readonly environment: Readonly<Record<string, string>> | undefined;
  readonly instanceId: string | undefined;
  readonly paths: { readonly stateDir: string; readonly homeDir: string };
  readonly modelId: string;
  readonly thinkingLevel: ThinkingLevel;
  readonly prompt: string;
}

/**
 * Runs one prompt on a Pi model and returns the assistant's text.
 *
 * The session is the smallest Pi can run: no tools, an in-memory session that
 * writes no session file, no extensions, skills, prompt templates, themes or
 * context files, and an empty temporary working directory, so nothing in the
 * user's project or Pi setup can act during a writing task. The model runtime
 * is the one chat builds (createPiModelRuntime, same agent dir), so a model id
 * resolves here exactly as it does in a chat thread.
 *
 * Unlike chat, this does not reset pi-ai's global API providers for isolated
 * accounts: that reset would also drop providers a running extension-enabled
 * chat registered. The model runtime already scopes credentials per account.
 */
async function runPiTextPrompt(
  sdk: Awaited<ReturnType<typeof loadPiCodingAgentModule>>,
  input: PiTextPromptInput,
  signal: AbortSignal,
): Promise<string> {
  const cwd = await FS.mkdtemp(path.join(OS.tmpdir(), "synara-pi-text-"));
  try {
    const modelRuntime = await createPiModelRuntime(
      input.agentDir,
      sdk,
      signal,
      input.environment,
      input.instanceId,
      input.paths,
    );
    signal.throwIfAborted();
    const services = await sdk.createAgentSessionServices({
      cwd,
      agentDir: input.agentDir,
      modelRuntime,
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: PI_TEXT_GENERATION_SYSTEM_PROMPT,
      },
    });
    const model = await resolvePiSessionModel({
      modelRuntime: services.modelRuntime,
      piSdk: sdk,
      modelId: input.modelId,
      environment: input.environment,
      instanceId: input.instanceId,
    });
    signal.throwIfAborted();
    const { session } = await sdk.createAgentSessionFromServices({
      services,
      sessionManager: sdk.SessionManager.inMemory(cwd),
      ...(model ? { model } : {}),
      thinkingLevel: input.thinkingLevel,
      noTools: "all",
    });
    const abort = () => {
      void session.abort();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await session.prompt(input.prompt);
      signal.throwIfAborted();
      const last = session.messages.findLast((message) => message.role === "assistant");
      if (last?.stopReason === "error") {
        throw new Error(last.errorMessage ?? "Pi request failed.");
      }
      if (last?.stopReason === "aborted") {
        throw new Error("Pi request was cancelled.");
      }
      return session.getLastAssistantText() ?? "";
    } finally {
      signal.removeEventListener("abort", abort);
      session.dispose();
    }
  } finally {
    await FS.rm(cwd, { recursive: true, force: true });
  }
}

type OperationInput = {
  readonly cwd: string;
  readonly model?: string;
  readonly modelSelection?: {
    readonly provider: string;
    readonly model: string;
    readonly options?: unknown;
  };
  readonly providerOptions?: ProviderStartOptions;
};
type OperationInputOf<K extends TextGenerationOperation> = Parameters<TextGenerationShape[K]>[0];

const makePiTextGeneration = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;

  function runPiOperation<Input extends OperationInput, S extends Schema.Top, Output>(
    operation: TextGenerationOperation,
    input: Input,
    build: (input: Input) => {
      readonly prompt: string;
      readonly outputSchemaJson: S;
      readonly rawTextFallback?: RawTextFallback;
    },
    transform: (generated: S["Type"], input: Input) => Output,
  ): Effect.Effect<Output, TextGenerationError, S["DecodingServices"]> {
    return Effect.gen(function* () {
      const modelSelection = resolvePiModelSelection(input);
      if (!modelSelection) {
        return yield* new TextGenerationError({
          operation,
          detail: "Invalid Pi model selection.",
        });
      }
      const { prompt, outputSchemaJson, rawTextFallback } = build(input);
      const piOptions = input.providerOptions?.pi;
      const instanceId = modelSelection.instanceId;
      const promptInput = (sdkAgentDir: string): PiTextPromptInput => ({
        agentDir: makePiStoragePaths({
          agentDir: piOptions?.agentDir,
          environment: piOptions?.environment,
          instanceId,
          stateDir: serverConfig.stateDir,
          homeDir: serverConfig.homeDir,
          sdkAgentDir,
        }).agentDir,
        environment: piOptions?.environment,
        instanceId,
        paths: { stateDir: serverConfig.stateDir, homeDir: serverConfig.homeDir },
        modelId: modelSelection.model,
        thinkingLevel:
          normalizePiThinkingLevel(modelSelection.options?.thinkingLevel) ??
          DEFAULT_PI_THINKING_LEVEL,
        prompt,
      });

      const raw = yield* Effect.tryPromise({
        try: async (signal) => {
          const sdk = await loadPiCodingAgentModule();
          signal.throwIfAborted();
          return runPiTextPrompt(sdk, promptInput(sdk.getAgentDir()), signal);
        },
        catch: (cause) =>
          new TextGenerationError({
            operation,
            detail:
              cause instanceof Error && cause.message.trim().length > 0
                ? `Pi request failed: ${cause.message}`
                : "Pi request failed.",
            cause,
          }),
      }).pipe(
        Effect.timeoutOption(PI_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(new TextGenerationError({ operation, detail: "Pi request timed out." })),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
      );

      if (Buffer.byteLength(raw, "utf8") > ACP_TEXT_GENERATION_MAX_OUTPUT_BYTES) {
        return yield* new TextGenerationError({
          operation,
          detail: `Pi output exceeded the ${ACP_TEXT_GENERATION_MAX_OUTPUT_BYTES}-byte limit.`,
        });
      }
      const trimmed = raw.trim();
      if (!trimmed) {
        return yield* new TextGenerationError({ operation, detail: "Pi returned empty output." });
      }
      const generated = yield* decodeStructuredTextGenerationOutput({
        schema: outputSchemaJson,
        raw: trimmed,
        operation,
        providerLabel: PI_TEXT_GENERATION_LABEL,
        ...(rawTextFallback ? { rawTextFallback } : {}),
      });
      return transform(generated, input);
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({ operation, detail: "Pi text generation failed.", cause }),
      ),
    );
  }

  return {
    generateCommitMessage: Effect.fn("PiTextGeneration.generateCommitMessage")(function* (
      input: OperationInputOf<"generateCommitMessage">,
    ) {
      return yield* runPiOperation(
        "generateCommitMessage",
        input,
        (input) =>
          buildCommitMessagePrompt({
            writingPreferences: input.writingPreferences,
            branch: input.branch,
            stagedSummary: input.stagedSummary,
            stagedPatch: input.stagedPatch,
            includeBranch: input.includeBranch === true,
          }),
        (generated) => ({
          subject: sanitizeCommitSubject(generated.subject),
          body: generated.body.trim(),
          ...("branch" in generated && typeof generated.branch === "string"
            ? { branch: sanitizeFeatureBranchName(generated.branch) }
            : {}),
        }),
      );
    }),
    generatePrContent: Effect.fn("PiTextGeneration.generatePrContent")(function* (
      input: OperationInputOf<"generatePrContent">,
    ) {
      return yield* runPiOperation(
        "generatePrContent",
        input,
        (input) =>
          buildPrContentPrompt({
            writingPreferences: input.writingPreferences,
            baseBranch: input.baseBranch,
            headBranch: input.headBranch,
            commitSummary: input.commitSummary,
            diffSummary: input.diffSummary,
            diffPatch: input.diffPatch,
            ...(input.prTemplate !== undefined ? { prTemplate: input.prTemplate } : {}),
          }),
        (generated) => ({
          title: sanitizePrTitle(generated.title),
          body: generated.body.trim(),
        }),
      );
    }),
    generateDiffSummary: Effect.fn("PiTextGeneration.generateDiffSummary")(function* (
      input: OperationInputOf<"generateDiffSummary">,
    ) {
      return yield* runPiOperation(
        "generateDiffSummary",
        input,
        (input) => buildDiffSummaryPrompt({ patch: input.patch }),
        (generated) => ({ summary: sanitizeDiffSummary(generated.summary) }),
      );
    }),
    generateBranchName: Effect.fn("PiTextGeneration.generateBranchName")(function* (
      input: OperationInputOf<"generateBranchName">,
    ) {
      return yield* runPiOperation(
        "generateBranchName",
        input,
        (input) =>
          buildBranchNamePrompt({
            message: input.message,
            ...(input.attachments ? { attachments: input.attachments } : {}),
          }),
        (generated) => ({ branch: sanitizeBranchFragment(generated.branch) }),
      );
    }),
    generateThreadTitle: Effect.fn("PiTextGeneration.generateThreadTitle")(function* (
      input: OperationInputOf<"generateThreadTitle">,
    ) {
      return yield* runPiOperation(
        "generateThreadTitle",
        input,
        (input) =>
          buildThreadTitlePrompt({
            message: input.message,
            ...(input.context ? { context: input.context } : {}),
            ...(input.attachments ? { attachments: input.attachments } : {}),
          }),
        (generated) => ({ title: sanitizeGeneratedThreadTitle(generated.title) }),
      );
    }),
    generateThreadRecap: Effect.fn("PiTextGeneration.generateThreadRecap")(function* (
      input: OperationInputOf<"generateThreadRecap">,
    ) {
      return yield* runPiOperation(
        "generateThreadRecap",
        input,
        (input) =>
          buildThreadRecapPrompt({
            ...(input.previousRecap ? { previousRecap: input.previousRecap } : {}),
            newMaterial: input.newMaterial,
            ...(input.currentState ? { currentState: input.currentState } : {}),
          }),
        (generated, input) => ({
          recap: sanitizeThreadRecap(generated.recap, input.previousRecap),
        }),
      );
    }),
    generateProjectDigest: Effect.fn("PiTextGeneration.generateProjectDigest")(function* (
      input: OperationInputOf<"generateProjectDigest">,
    ) {
      return yield* runPiOperation(
        "generateProjectDigest",
        input,
        (input) =>
          buildProjectDigestPrompt({
            ...(input.previousSummary ? { previousSummary: input.previousSummary } : {}),
            activity: input.activity,
            coverage: input.coverage,
            pinnedFocus: input.pinnedFocus,
          }),
        (generated) => generated,
      );
    }),
    generateAutomationIntent: Effect.fn("PiTextGeneration.generateAutomationIntent")(function* (
      input: OperationInputOf<"generateAutomationIntent">,
    ) {
      return yield* runPiOperation(
        "generateAutomationIntent",
        input,
        (input) =>
          buildAutomationIntentPrompt({
            message: input.message,
            ...(input.defaultMode ? { defaultMode: input.defaultMode } : {}),
            nowIso: input.nowIso,
          }),
        (generated) => generated,
      );
    }),
    evaluateAutomationCompletion: Effect.fn("PiTextGeneration.evaluateAutomationCompletion")(
      function* (input: OperationInputOf<"evaluateAutomationCompletion">) {
        return yield* runPiOperation(
          "evaluateAutomationCompletion",
          input,
          (input) => buildAutomationCompletionEvaluationPrompt(input),
          (generated) => generated,
        );
      },
    ),
    generateTextTask: Effect.fn("PiTextGeneration.generateTextTask")(function* (
      input: OperationInputOf<"generateTextTask">,
    ) {
      return yield* runPiOperation(
        "generateTextTask",
        input,
        (input) => buildTextTaskPrompt({ prompt: input.prompt }),
        (generated) => ({ text: generated.text.trim() }),
      );
    }),
  };
});

export const PiTextGenerationServiceLive = Layer.effect(PiTextGeneration, makePiTextGeneration);
export const PiTextGenerationLive = Layer.effect(TextGeneration, makePiTextGeneration);

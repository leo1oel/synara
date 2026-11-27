/**
 * AntigravityTextGeneration - Git writing and host text tasks (Lattice
 * Proofread, Polish, annotation revisions) on an Antigravity model, over
 * `agy acp` like Antigravity chats.
 *
 * The session is read-only and never interactive: it attaches no MCP servers
 * and announces no file-system or terminal client capabilities, runs in
 * Antigravity's Plan mode, and declines every permission request (edits,
 * commands, and the questions agy asks through the same request). It never
 * signs in: a signed-out `agy` fails with "Antigravity is not signed in"
 * instead of opening Google's sign-in page (resolveAntigravityAcpAuthMethodId
 * only accepts a configured GEMINI_API_KEY).
 *
 * @module AntigravityTextGeneration
 */
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as Acp from "@agentclientprotocol/sdk";

import type { AntigravityModelSelection, ProviderStartOptions } from "@synara/contracts";
import { sanitizeGeneratedThreadTitle } from "@synara/shared/chatThreads";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@synara/shared/git";

import { ACTIVE_AGENT_HOST_PROFILE } from "../../agentGateway/hostProfile.ts";
import { findSelectConfig, flattenConfigOptions } from "../../provider/acp/AcpConfigOptions.ts";
import type { AcpSessionRuntimeShape } from "../../provider/acp/AcpSessionRuntime.ts";
import {
  antigravityModelConfig,
  type AntigravityAcpRuntimeSettings,
  makeAntigravityAcpRuntime,
  resolveAntigravityConfigModel,
  resolveAntigravityThoughtLevel,
} from "../../provider/acp/AntigravityAcpSupport.ts";
import { TextGenerationError } from "../Errors.ts";
import {
  AntigravityTextGeneration,
  TextGeneration,
  type TextGenerationShape,
} from "../Services/TextGeneration.ts";
import {
  buildAutomationIntentPrompt,
  buildAutomationCompletionEvaluationPrompt,
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildComposerPredictionPrompt,
  buildDiffSummaryPrompt,
  buildTextTaskPrompt,
  buildPrContentPrompt,
  buildThreadRecapPrompt,
  buildProjectDigestPrompt,
  buildThreadTitlePrompt,
  sanitizeCommitSubject,
  sanitizeComposerPrediction,
  sanitizeDiffSummary,
  sanitizeThreadRecap,
  sanitizePrTitle,
} from "../textGenerationShared.ts";
import {
  isTextGenerationError,
  mapError,
  runAcpTextGeneration,
  type AcpTextGenerationConfig,
} from "./AcpTextGeneration.ts";

const ANTIGRAVITY_TEXT_GENERATION_LABEL = "Antigravity";

const ANTIGRAVITY_TIMEOUT_MS = 180_000;

/** Antigravity's read-only mode: it plans and answers but edits nothing. */
const ANTIGRAVITY_READ_ONLY_MODE = "plan";

function resolveAntigravityModelSelection(input: {
  readonly model?: string;
  readonly modelSelection?: {
    readonly provider: string;
    readonly model: string;
    readonly options?: unknown;
  };
}): AntigravityModelSelection | null {
  if (input.modelSelection?.provider === "antigravity") {
    return input.modelSelection as AntigravityModelSelection;
  }
  return null;
}

export function resolveAntigravitySettings(
  providerOptions: ProviderStartOptions | undefined,
): AntigravityAcpRuntimeSettings {
  const antigravityOptions = providerOptions?.antigravity;
  return {
    ...(antigravityOptions?.binaryPath ? { binaryPath: antigravityOptions.binaryPath } : {}),
    environment: {
      ...antigravityOptions?.environment,
      // A background task must never update the CLI or open a browser.
      AGY_CLI_DISABLE_AUTO_UPDATE: "true",
      NO_BROWSER: "true",
    },
  };
}

/** Declines a permission request: its reject option when it offers one, else cancels it. */
export function declineAntigravityPermission(
  request: Acp.RequestPermissionRequest,
): Acp.RequestPermissionResponse {
  const reject = request.options.find(
    (option) => option.kind === "reject_once" || option.kind === "reject_always",
  );
  return reject
    ? { outcome: { outcome: "selected", optionId: reject.optionId } }
    : { outcome: { outcome: "cancelled" } };
}

/**
 * Puts the session in Plan mode before the prompt. A session that advertises
 * modes but not Plan, or does not confirm the switch, fails the task rather
 * than run it in a mode that may edit.
 */
const enterReadOnlyMode = (
  runtime: AcpSessionRuntimeShape,
  mapErrorForOperation: (detail: string, cause?: unknown) => TextGenerationError,
) =>
  Effect.gen(function* () {
    const modeConfig = findSelectConfig(yield* runtime.getConfigOptions, {
      id: "mode",
      category: "mode",
    });
    if (modeConfig) {
      if (modeConfig.currentValue === ANTIGRAVITY_READ_ONLY_MODE) return;
      if (
        !flattenConfigOptions(modeConfig.options).some(
          (option) => option.value === ANTIGRAVITY_READ_ONLY_MODE,
        )
      ) {
        return yield* mapErrorForOperation("Antigravity offers no read-only Plan mode.");
      }
      const updated = yield* runtime.setConfigOption(modeConfig.id, ANTIGRAVITY_READ_ONLY_MODE);
      const confirmed = findSelectConfig(updated.configOptions, {
        id: modeConfig.id,
        category: "mode",
      });
      if (confirmed?.currentValue !== ANTIGRAVITY_READ_ONLY_MODE) {
        return yield* mapErrorForOperation("Antigravity did not confirm its read-only Plan mode.");
      }
      return;
    }
    const legacyModes = yield* runtime.getModeState;
    if (!legacyModes || legacyModes.currentModeId === ANTIGRAVITY_READ_ONLY_MODE) return;
    if (!legacyModes.availableModes.some((mode) => mode.id === ANTIGRAVITY_READ_ONLY_MODE)) {
      return yield* mapErrorForOperation("Antigravity offers no read-only Plan mode.");
    }
    yield* runtime.setMode(ANTIGRAVITY_READ_ONLY_MODE, { legacy: true });
  });

/** Selects the chosen model and its thinking level in the session's config options. */
const applyModelSelection = (
  runtime: AcpSessionRuntimeShape,
  modelSelection: AntigravityModelSelection,
  mapErrorForOperation: (detail: string, cause?: unknown) => TextGenerationError,
) =>
  Effect.gen(function* () {
    const configOptions = yield* runtime.getConfigOptions;
    const modelConfig = antigravityModelConfig(configOptions);
    if (!modelConfig) {
      return yield* mapErrorForOperation("Antigravity did not report its models.");
    }
    const choice = resolveAntigravityConfigModel(modelConfig, {
      model: modelSelection.model,
      reasoningEffort: modelSelection.options?.reasoningEffort,
    });
    if (!choice.modelId) {
      return yield* mapErrorForOperation(
        `Antigravity does not offer the model '${choice.label}'. Refresh the model list and pick an available model.`,
      );
    }
    const selectedConfig =
      choice.modelId === modelConfig.currentValue
        ? configOptions
        : (yield* runtime.setConfigOption(modelConfig.id, choice.modelId)).configOptions;
    const thoughtLevel = resolveAntigravityThoughtLevel(selectedConfig, choice);
    if (thoughtLevel.kind === "unsupported") {
      return yield* mapErrorForOperation(
        `Antigravity model '${modelSelection.model}' does not offer '${thoughtLevel.effort}' as a thinking level.`,
      );
    }
    if (thoughtLevel.kind === "set") {
      yield* runtime.setConfigOption(thoughtLevel.configId, thoughtLevel.value);
    }
  });

const antigravityAcpConfig: AcpTextGenerationConfig<
  AntigravityModelSelection,
  AntigravityAcpRuntimeSettings
> = {
  providerLabel: ANTIGRAVITY_TEXT_GENERATION_LABEL,
  timeoutMs: ANTIGRAVITY_TIMEOUT_MS,
  resolveModelSelection: resolveAntigravityModelSelection,
  resolveSettings: (providerOptions) => resolveAntigravitySettings(providerOptions),
  makeRuntime: ({ childProcessSpawner, settings, cwd }) =>
    makeAntigravityAcpRuntime({
      antigravitySettings: settings,
      childProcessSpawner,
      cwd,
      clientInfo: { name: ACTIVE_AGENT_HOST_PROFILE.displayName, version: "0.0.0" },
    }),
  prepareRuntime: ({ runtime, modelSelection, mapError: mapErrorForOperation }) =>
    Effect.gen(function* () {
      yield* runtime.handleRequestPermission((request) =>
        Effect.succeed(declineAntigravityPermission(request)),
      );
      yield* runtime.start();
      yield* applyModelSelection(runtime, modelSelection, mapErrorForOperation);
      yield* enterReadOnlyMode(runtime, mapErrorForOperation);
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : mapErrorForOperation("Antigravity ACP request failed.", cause),
      ),
    ),
  mapError,
};

const makeAntigravityTextGeneration = Effect.gen(function* () {
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "AntigravityTextGeneration.generateCommitMessage",
  )(function* (input) {
    const modelSelection = resolveAntigravityModelSelection(input);
    if (!modelSelection) {
      return yield* new TextGenerationError({
        operation: "generateCommitMessage",
        detail: "Invalid Antigravity model selection.",
      });
    }

    const { prompt, outputSchemaJson } = buildCommitMessagePrompt({
      writingPreferences: input.writingPreferences,
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });
    const generated = yield* runAcpTextGeneration(antigravityAcpConfig, {
      childProcessSpawner,
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      modelSelection,
      providerOptions: input.providerOptions,
    });

    return {
      subject: sanitizeCommitSubject(generated.subject),
      body: generated.body.trim(),
      ...("branch" in generated && typeof generated.branch === "string"
        ? { branch: sanitizeFeatureBranchName(generated.branch) }
        : {}),
    };
  });

  const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
    "AntigravityTextGeneration.generatePrContent",
  )(function* (input) {
    const modelSelection = resolveAntigravityModelSelection(input);
    if (!modelSelection) {
      return yield* new TextGenerationError({
        operation: "generatePrContent",
        detail: "Invalid Antigravity model selection.",
      });
    }

    const { prompt, outputSchemaJson } = buildPrContentPrompt({
      writingPreferences: input.writingPreferences,
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
      ...(input.prTemplate !== undefined ? { prTemplate: input.prTemplate } : {}),
    });
    const generated = yield* runAcpTextGeneration(antigravityAcpConfig, {
      childProcessSpawner,
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      modelSelection,
      providerOptions: input.providerOptions,
    });

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    };
  });

  const generateDiffSummary: TextGenerationShape["generateDiffSummary"] = Effect.fn(
    "AntigravityTextGeneration.generateDiffSummary",
  )(function* (input) {
    const modelSelection = resolveAntigravityModelSelection(input);
    if (!modelSelection) {
      return yield* new TextGenerationError({
        operation: "generateDiffSummary",
        detail: "Invalid Antigravity model selection.",
      });
    }

    const { prompt, outputSchemaJson, rawTextFallback } = buildDiffSummaryPrompt({
      patch: input.patch,
    });
    const generated = yield* runAcpTextGeneration(antigravityAcpConfig, {
      childProcessSpawner,
      operation: "generateDiffSummary",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      rawTextFallback,
      modelSelection,
      providerOptions: input.providerOptions,
    });

    return {
      summary: sanitizeDiffSummary(generated.summary),
    };
  });

  const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
    "AntigravityTextGeneration.generateBranchName",
  )(function* (input) {
    const modelSelection = resolveAntigravityModelSelection(input);
    if (!modelSelection) {
      return yield* new TextGenerationError({
        operation: "generateBranchName",
        detail: "Invalid Antigravity model selection.",
      });
    }

    const { prompt, outputSchemaJson, rawTextFallback } = buildBranchNamePrompt({
      message: input.message,
      ...(input.attachments ? { attachments: input.attachments } : {}),
    });
    const generated = yield* runAcpTextGeneration(antigravityAcpConfig, {
      childProcessSpawner,
      operation: "generateBranchName",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      rawTextFallback,
      modelSelection,
      providerOptions: input.providerOptions,
    });

    return {
      branch: sanitizeBranchFragment(generated.branch),
    };
  });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
    "AntigravityTextGeneration.generateThreadTitle",
  )(function* (input) {
    const modelSelection = resolveAntigravityModelSelection(input);
    if (!modelSelection) {
      return yield* new TextGenerationError({
        operation: "generateThreadTitle",
        detail: "Invalid Antigravity model selection.",
      });
    }

    const { prompt, outputSchemaJson, rawTextFallback } = buildThreadTitlePrompt({
      message: input.message,
      ...(input.context ? { context: input.context } : {}),
      ...(input.attachments ? { attachments: input.attachments } : {}),
    });
    const generated = yield* runAcpTextGeneration(antigravityAcpConfig, {
      childProcessSpawner,
      operation: "generateThreadTitle",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      rawTextFallback,
      modelSelection,
      providerOptions: input.providerOptions,
    });

    return {
      title: sanitizeGeneratedThreadTitle(generated.title),
    };
  });

  const generateThreadRecap: TextGenerationShape["generateThreadRecap"] = Effect.fn(
    "AntigravityTextGeneration.generateThreadRecap",
  )(function* (input) {
    const modelSelection = resolveAntigravityModelSelection(input);
    if (!modelSelection) {
      return yield* new TextGenerationError({
        operation: "generateThreadRecap",
        detail: "Invalid Antigravity model selection.",
      });
    }

    const { prompt, outputSchemaJson, rawTextFallback } = buildThreadRecapPrompt({
      ...(input.previousRecap ? { previousRecap: input.previousRecap } : {}),
      newMaterial: input.newMaterial,
      ...(input.currentState ? { currentState: input.currentState } : {}),
    });
    const generated = yield* runAcpTextGeneration(antigravityAcpConfig, {
      childProcessSpawner,
      operation: "generateThreadRecap",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      rawTextFallback,
      modelSelection,
      providerOptions: input.providerOptions,
    });

    return {
      recap: sanitizeThreadRecap(generated.recap, input.previousRecap),
    };
  });

  const generateComposerPrediction: TextGenerationShape["generateComposerPrediction"] = Effect.fn(
    "AntigravityTextGeneration.generateComposerPrediction",
  )(function* (input) {
    const modelSelection = resolveAntigravityModelSelection(input);
    if (!modelSelection) {
      return yield* new TextGenerationError({
        operation: "generateComposerPrediction",
        detail: "Invalid Antigravity model selection.",
      });
    }

    const { prompt, outputSchemaJson, rawTextFallback } = buildComposerPredictionPrompt({
      conversation: input.conversation,
    });
    const generated = yield* runAcpTextGeneration(antigravityAcpConfig, {
      childProcessSpawner,
      operation: "generateComposerPrediction",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      rawTextFallback,
      modelSelection,
      providerOptions: input.providerOptions,
    });

    return { suggestion: sanitizeComposerPrediction(generated.suggestion) };
  });

  const generateProjectDigest: TextGenerationShape["generateProjectDigest"] = Effect.fn(
    "AntigravityTextGeneration.generateProjectDigest",
  )(function* (input) {
    const modelSelection = resolveAntigravityModelSelection(input);
    if (!modelSelection) {
      return yield* new TextGenerationError({
        operation: "generateProjectDigest",
        detail: "Invalid Antigravity model selection.",
      });
    }
    const { prompt, outputSchemaJson, rawTextFallback } = buildProjectDigestPrompt({
      ...(input.previousSummary ? { previousSummary: input.previousSummary } : {}),
      activity: input.activity,
      coverage: input.coverage,
      pinnedFocus: input.pinnedFocus,
    });
    return yield* runAcpTextGeneration(antigravityAcpConfig, {
      childProcessSpawner,
      operation: "generateProjectDigest",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      rawTextFallback,
      modelSelection,
      providerOptions: input.providerOptions,
    });
  });

  const generateAutomationIntent: TextGenerationShape["generateAutomationIntent"] = Effect.fn(
    "AntigravityTextGeneration.generateAutomationIntent",
  )(function* (input) {
    const modelSelection = resolveAntigravityModelSelection(input);
    if (!modelSelection) {
      return yield* new TextGenerationError({
        operation: "generateAutomationIntent",
        detail: "Invalid Antigravity model selection.",
      });
    }

    const { prompt, outputSchemaJson } = buildAutomationIntentPrompt({
      message: input.message,
      ...(input.defaultMode ? { defaultMode: input.defaultMode } : {}),
      nowIso: input.nowIso,
    });
    return yield* runAcpTextGeneration(antigravityAcpConfig, {
      childProcessSpawner,
      operation: "generateAutomationIntent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      modelSelection,
      providerOptions: input.providerOptions,
    });
  });

  const evaluateAutomationCompletion: TextGenerationShape["evaluateAutomationCompletion"] =
    Effect.fn("AntigravityTextGeneration.evaluateAutomationCompletion")(function* (input) {
      const modelSelection = resolveAntigravityModelSelection(input);
      if (!modelSelection) {
        return yield* new TextGenerationError({
          operation: "evaluateAutomationCompletion",
          detail: "Invalid Antigravity model selection.",
        });
      }

      const { prompt, outputSchemaJson } = buildAutomationCompletionEvaluationPrompt(input);
      return yield* runAcpTextGeneration(antigravityAcpConfig, {
        childProcessSpawner,
        operation: "evaluateAutomationCompletion",
        cwd: input.cwd,
        prompt,
        outputSchemaJson,
        modelSelection,
        providerOptions: input.providerOptions,
      });
    });

  const generateTextTask: TextGenerationShape["generateTextTask"] = Effect.fn(
    "AntigravityTextGeneration.generateTextTask",
  )(function* (input) {
    const modelSelection = resolveAntigravityModelSelection(input);
    if (!modelSelection) {
      return yield* new TextGenerationError({
        operation: "generateTextTask",
        detail: "Invalid Antigravity model selection.",
      });
    }

    const { prompt, outputSchemaJson, rawTextFallback } = buildTextTaskPrompt({
      prompt: input.prompt,
    });
    const generated = yield* runAcpTextGeneration(antigravityAcpConfig, {
      childProcessSpawner,
      operation: "generateTextTask",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      rawTextFallback,
      modelSelection,
      providerOptions: input.providerOptions,
    });
    return { text: generated.text.trim() };
  });

  return {
    generateCommitMessage,
    generatePrContent,
    generateDiffSummary,
    generateBranchName,
    generateThreadTitle,
    generateThreadRecap,
    generateComposerPrediction,
    generateProjectDigest,
    generateAutomationIntent,
    evaluateAutomationCompletion,
    generateTextTask,
  } satisfies TextGenerationShape;
});

export const AntigravityTextGenerationServiceLive = Layer.effect(
  AntigravityTextGeneration,
  makeAntigravityTextGeneration,
);

export const AntigravityTextGenerationLive = Layer.effect(
  TextGeneration,
  makeAntigravityTextGeneration,
);

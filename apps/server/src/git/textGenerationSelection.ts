import {
  GIT_TEXT_GENERATION_PROVIDERS,
  SETTINGS_ONLY_TEXT_GENERATION_PROVIDERS,
  type GitTextGenerationProvider,
  type ModelSelection,
  type ProviderKind,
  type ProviderStartOptions,
} from "@synara/contracts";

export const GIT_TEXT_GENERATION_PROVIDER_ORDER = GIT_TEXT_GENERATION_PROVIDERS;
export type { GitTextGenerationProvider };

const GIT_TEXT_GENERATION_PROVIDER_SET = new Set<ProviderKind>(GIT_TEXT_GENERATION_PROVIDERS);

/**
 * Providers that run text generation only on a model the writer chose, never
 * as a fallback: Pi has no default model, and Antigravity runs a coding agent
 * on the writer's Google account, which nobody should be signed up for
 * silently.
 */
const CHOSEN_ONLY_TEXT_GENERATION_PROVIDERS = ["pi", "antigravity"] as const;
export type TextGenerationFallbackProvider = Exclude<
  GitTextGenerationProvider,
  (typeof CHOSEN_ONLY_TEXT_GENERATION_PROVIDERS)[number]
>;

export function isTextGenerationFallbackProvider(
  provider: ProviderKind,
): provider is TextGenerationFallbackProvider {
  return (
    hasDedicatedTextGenerationProvider(provider) &&
    !(CHOSEN_ONLY_TEXT_GENERATION_PROVIDERS as ReadonlyArray<ProviderKind>).includes(provider)
  );
}

export interface TextGenerationProviderInput {
  readonly modelSelection: ModelSelection;
  readonly providerOptions?: ProviderStartOptions;
  readonly codexHomePath?: string;
}

export function hasDedicatedTextGenerationProvider(
  provider: ProviderKind | undefined,
): provider is GitTextGenerationProvider {
  return provider !== undefined && GIT_TEXT_GENERATION_PROVIDER_SET.has(provider);
}

/** Whether a chat on this provider runs its own titles, recaps and predictions. */
export function servesChatTextGeneration(
  provider: ProviderKind | undefined,
): provider is GitTextGenerationProvider {
  return (
    hasDedicatedTextGenerationProvider(provider) &&
    !(SETTINGS_ONLY_TEXT_GENERATION_PROVIDERS as ReadonlyArray<ProviderKind>).includes(provider)
  );
}

/**
 * {@link resolveTextGenerationInputForSelection} for a chat's own selection:
 * null for a provider that serves only Settings choices, so the caller falls
 * back to the configured model.
 */
export function resolveChatTextGenerationInputForSelection(
  modelSelection: ModelSelection | undefined,
  providerOptions: ProviderStartOptions | undefined,
  resolvedProvider?: ProviderKind,
): TextGenerationProviderInput | null {
  if (!servesChatTextGeneration(resolvedProvider ?? modelSelection?.provider)) return null;
  return resolveTextGenerationInputForSelection(modelSelection, providerOptions, resolvedProvider);
}

export function resolveTextGenerationInputForSelection(
  modelSelection: ModelSelection | undefined,
  providerOptions: ProviderStartOptions | undefined,
  resolvedProvider?: ProviderKind,
): TextGenerationProviderInput | null {
  if (!modelSelection) {
    return null;
  }
  const routedModelSelection =
    resolvedProvider !== undefined && resolvedProvider !== modelSelection.provider
      ? ({
          provider: resolvedProvider,
          instanceId: modelSelection.instanceId,
          model: modelSelection.model,
        } as ModelSelection)
      : modelSelection;
  if (!hasDedicatedTextGenerationProvider(routedModelSelection.provider)) {
    return null;
  }

  if (routedModelSelection.provider === "codex") {
    return {
      modelSelection: routedModelSelection,
      ...(providerOptions ? { providerOptions } : {}),
      ...(providerOptions?.codex?.homePath
        ? { codexHomePath: providerOptions.codex.homePath }
        : {}),
    };
  }

  return {
    modelSelection: routedModelSelection,
    ...(providerOptions ? { providerOptions } : {}),
  };
}

export function buildGitTextGenerationCallInput(input: {
  readonly textGenerationModel?: string | undefined;
  readonly textGenerationModelSelection?: ModelSelection | undefined;
  readonly codexHomePath?: string | undefined;
  readonly providerOptions?: ProviderStartOptions | undefined;
}): {
  readonly model?: string;
  readonly modelSelection?: ModelSelection;
  readonly codexHomePath?: string;
  readonly providerOptions?: ProviderStartOptions;
} {
  const modelSelection = input.textGenerationModelSelection;
  const model = input.textGenerationModel?.trim() || modelSelection?.model;

  return {
    ...(model ? { model } : {}),
    ...(modelSelection ? { modelSelection } : {}),
    ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
    ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
  };
}

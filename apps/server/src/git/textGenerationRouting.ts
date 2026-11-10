import type {
  ModelSelection,
  ProviderStartOptions,
  ServerProviderStatus,
  ServerSettings,
} from "@synara/contracts";
import {
  mergeProviderStartOptions,
  providerStartOptionsFromInstance,
  resolveModelSelectionInstanceId,
  resolveProviderInstance,
} from "@synara/shared/providerInstances";

import { resolveRunnableModelSelection } from "../provider/runnableModelSelection.ts";

export type TextGenerationRouting =
  | {
      readonly model: string;
      readonly modelSelection: ModelSelection | undefined;
      readonly providerOptions: ProviderStartOptions | undefined;
    }
  | { readonly unavailable: string };

/**
 * Route a Git writing (or other auxiliary text) request from the client.
 *
 * Legacy/native callers may pin a text-generation model via the model-only
 * `textGenerationModel` field. Downstream routing prefers a model selection
 * over the raw model, so the global settings selection must only be injected
 * when the caller supplied neither — injecting it alongside an explicit model
 * would silently reroute the request to the globally configured model.
 *
 * A selection (the caller's, which the web client fills from Settings, or the
 * Settings default) runs only while its provider is usable; otherwise the
 * first ready provider writes instead, so a writer without Codex still gets a
 * commit message.
 */
export function resolveTextGenerationRouting(
  settings: ServerSettings,
  statuses: ReadonlyArray<ServerProviderStatus>,
  input: {
    readonly textGenerationModel?: string | undefined;
    readonly textGenerationModelSelection?: ModelSelection | undefined;
    readonly providerOptions?: ProviderStartOptions | undefined;
  },
): TextGenerationRouting {
  const explicitModel = input.textGenerationModel?.trim();
  if (!input.textGenerationModelSelection && explicitModel) {
    return {
      model: explicitModel,
      modelSelection: undefined,
      providerOptions: input.providerOptions,
    };
  }
  // A caller selection on a provider without a text-generation path (a Grok
  // thread's recap, say) has always been written by the Git writing model.
  const runnable = resolveRunnableModelSelection({
    settings,
    preferences: [
      ...(input.textGenerationModelSelection ? [input.textGenerationModelSelection] : []),
      settings.textGenerationModelSelection,
    ],
    statuses,
    purpose: "text-generation",
  });
  if (runnable.kind === "unavailable") return { unavailable: runnable.message };
  const modelSelection = runnable.selection;
  // The caller's model and options were built for the selection it asked for.
  const asked = runnable.kind === "selected" && runnable.preference === 0;
  const instance = resolveProviderInstance(settings, {
    provider: modelSelection.provider,
    instanceId: resolveModelSelectionInstanceId(modelSelection),
  });
  return {
    // A fallback runs on its own provider's model and instance options, never
    // the pinned slug or client options of the provider it replaced.
    model: (asked && explicitModel) || modelSelection.model,
    modelSelection,
    providerOptions: mergeProviderStartOptions(
      asked ? input.providerOptions : undefined,
      instance ? providerStartOptionsFromInstance(instance) : undefined,
    ),
  };
}

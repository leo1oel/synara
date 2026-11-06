// FILE: unavailableModels.ts
// Purpose: Read the models an account refused at run time (the provider status's
//          `unavailableModels`, learned from a failed turn) and pick where the
//          composer goes when its model is one of them.
// Layer: Web provider-status helpers

import type {
  ProviderInstanceId,
  ProviderKind,
  ServerProviderStatus,
  ServerProviderUnavailableModel,
} from "@synara/contracts";
import { getDefaultModel } from "@synara/shared/model";

import type { ProviderModelOption } from "../providerModelOptions";

function statusFor(
  statuses: ReadonlyArray<ServerProviderStatus> | undefined,
  provider: ProviderKind,
  instanceId: string,
): ServerProviderStatus | undefined {
  return statuses?.find(
    (status) =>
      (status.driver ?? status.provider) === provider &&
      (status.instanceId ?? status.provider) === instanceId,
  );
}

/** The refused models of one account; empty when it has none. */
export function unavailableModelsFor(
  statuses: ReadonlyArray<ServerProviderStatus> | undefined,
  provider: ProviderKind,
  instanceId: ProviderInstanceId | string,
): ReadonlyArray<ServerProviderUnavailableModel> {
  return statusFor(statuses, provider, instanceId)?.unavailableModels ?? [];
}

/** Whether the account refused `model`. */
export function isModelUnavailable(
  statuses: ReadonlyArray<ServerProviderStatus> | undefined,
  provider: ProviderKind,
  instanceId: ProviderInstanceId | string,
  model: string,
): boolean {
  return unavailableModelsFor(statuses, provider, instanceId).some(
    (entry) => entry.model === model,
  );
}

/**
 * Where the composer moves when its model was refused: the provider's default
 * model, or else the first listed model the account has not refused. Null when
 * the model is still usable, or when nothing usable is left to move to.
 */
export function resolveUnavailableModelFallback(input: {
  readonly provider: ProviderKind;
  readonly model: string;
  readonly unavailableModels: ReadonlyArray<ServerProviderUnavailableModel>;
  readonly options: ReadonlyArray<ProviderModelOption>;
}): string | null {
  const refused = new Set(input.unavailableModels.map((entry) => entry.model));
  if (!refused.has(input.model)) return null;
  const defaultModel = getDefaultModel(input.provider);
  if (defaultModel !== null && !refused.has(defaultModel)) return defaultModel;
  return input.options.find((option) => !refused.has(option.slug))?.slug ?? null;
}

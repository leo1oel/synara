// FILE: useUnavailableModelFallback.ts
// Purpose: Move the composer off a model its account refused at run time, so the
//          next send does not fail the same way the last one did.
// Layer: Chat composer hooks
// Depends on: the provider status's `unavailableModels` (see lib/unavailableModels).

import type {
  ModelSlug,
  ProviderInstanceId,
  ProviderKind,
  ServerProviderStatus,
} from "@synara/contracts";
import { useEffect } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { resolveUnavailableModelFallback, unavailableModelsFor } from "~/lib/unavailableModels";
import type { ProviderModelOption } from "../../providerModelOptions";

export function useUnavailableModelFallback(input: {
  readonly enabled: boolean;
  readonly provider: ProviderKind;
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly statuses: ReadonlyArray<ServerProviderStatus> | undefined;
  /** The account's model catalog, for when its default model was refused too. */
  readonly options: ReadonlyArray<ProviderModelOption> | undefined;
  /** `from` is the refused model the composer leaves, so the panel can say so. */
  readonly select: (
    provider: ProviderKind,
    model: ModelSlug,
    instanceId: ProviderInstanceId,
    from: string,
  ) => void;
}): void {
  const fallback = input.enabled
    ? resolveUnavailableModelFallback({
        provider: input.provider,
        model: input.model,
        unavailableModels: unavailableModelsFor(input.statuses, input.provider, input.instanceId),
        options: input.options ?? [],
      })
    : null;
  const select = useStableCallback(input.select);
  const { provider, instanceId, model } = input;
  useEffect(() => {
    if (fallback === null) return;
    select(provider, fallback as ModelSlug, instanceId, model);
  }, [fallback, provider, instanceId, model, select]);
}

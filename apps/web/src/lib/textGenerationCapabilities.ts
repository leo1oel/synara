// FILE: textGenerationCapabilities.ts
// Purpose: Keeps auxiliary text-generation routing aligned with the server's implemented drivers.
// Layer: Web provider capability helper

import {
  GIT_TEXT_GENERATION_PROVIDERS,
  type ModelSelection,
  type ProviderKind,
  SETTINGS_ONLY_TEXT_GENERATION_PROVIDERS,
} from "@synara/contracts";

// Settings-only providers (Antigravity) never run a chat's auxiliary tasks.
const TEXT_GENERATION_PROVIDERS = new Set<ProviderKind>(
  GIT_TEXT_GENERATION_PROVIDERS.filter(
    (provider) =>
      !(SETTINGS_ONLY_TEXT_GENERATION_PROVIDERS as ReadonlyArray<ProviderKind>).includes(provider),
  ),
);

export function supportsTextGeneration(provider: ProviderKind): boolean {
  return TEXT_GENERATION_PROVIDERS.has(provider);
}

// Recaps and automation-intent extraction should follow the active account when its
// driver supports one-shot generation. Unsupported chat drivers deliberately omit
// the override so the server can use the configured text-generation fallback.
export function resolveAuxiliaryTextGenerationSelection(input: {
  readonly provider: ProviderKind;
  readonly modelSelection: ModelSelection;
}): ModelSelection | null {
  return supportsTextGeneration(input.provider) ? input.modelSelection : null;
}

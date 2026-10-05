// Disabled account and Beta availability guidance shared by orchestration entry points.
// Legacy driver-wide adapter gates were removed by the Lattice integration; upstream 1.0
// explicitly checks each resolved provider instance before asking for this message.
import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@synara/contracts";
import { isServerBetaFeatureEnabled } from "../betaFeatureGate";

export function providerDisabledSettingsMessage(
  provider: ProviderKind,
  isEnabled: (feature: string) => boolean = isServerBetaFeatureEnabled,
): string {
  return isEnabled(provider)
    ? `${PROVIDER_DISPLAY_NAMES[provider]} is disabled in Settings > Providers.`
    : `${PROVIDER_DISPLAY_NAMES[provider]} is available in Synara Beta.`;
}

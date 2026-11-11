// FILE: betaFeatureGate.ts
// Purpose: The server's read of the shared Beta-only feature list.
// Layer: Runtime gate (consumed by settings projection and provider messaging)
// Exports: SERVER_DESKTOP_FLAVOR, isServerBetaFeatureEnabled

import { desktopFlavorFromBundleId, isBetaFeatureEnabled } from "@synara/shared/betaFeatures";
import { SYNARA_DESKTOP_BUNDLE_ID_ENV } from "@synara/shared/desktopIdentity";

// Lattice's loopback service has no Synara bundle identity, but ships the Stable
// feature boundary rather than the upstream standalone server's Beta defaults.
export const SERVER_DESKTOP_FLAVOR =
  process.env.AGENT_HOST_PROFILE === "lattice"
    ? "production"
    : desktopFlavorFromBundleId(process.env[SYNARA_DESKTOP_BUNDLE_ID_ENV]);

export const isServerBetaFeatureEnabled = (feature: string): boolean =>
  isBetaFeatureEnabled(feature, SERVER_DESKTOP_FLAVOR);

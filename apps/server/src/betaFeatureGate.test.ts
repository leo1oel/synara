// FILE: betaFeatureGate.test.ts
// Purpose: Verify the server host's shared Beta-only feature policy.
import { afterEach, expect, it, vi } from "vitest";
import {
  SYNARA_BETA_BUNDLE_ID,
  SYNARA_DESKTOP_BUNDLE_ID_ENV,
  SYNARA_PRODUCTION_BUNDLE_ID,
} from "@synara/shared/desktopIdentity";
import { ACCOUNT_INBOX_BETA_FEATURE } from "@synara/shared/betaFeatures";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// Lattice's loopback service has no bundle identity but ships the Stable boundary.
// Upstream 1.5 has no Beta-only feature left, so the flavor itself is the contract.
it.each(["lattice", "synara"])("applies the Stable boundary for the %s host", async (host) => {
  vi.stubEnv("AGENT_HOST_PROFILE", host);
  vi.stubEnv(SYNARA_DESKTOP_BUNDLE_ID_ENV, "");
  vi.resetModules();
  const { SERVER_DESKTOP_FLAVOR, isServerBetaFeatureEnabled } =
    await import("./betaFeatureGate.ts");
  expect(SERVER_DESKTOP_FLAVOR).toBe(host === "lattice" ? "production" : "unknown");
  expect(isServerBetaFeatureEnabled("codex")).toBe(true);
});

it.each([
  [SYNARA_PRODUCTION_BUNDLE_ID, true],
  [SYNARA_BETA_BUNDLE_ID, true],
] as const)("allows saved Inbox recaps on the host bundle (%s)", async (bundleId, enabled) => {
  vi.stubEnv(SYNARA_DESKTOP_BUNDLE_ID_ENV, bundleId);
  vi.resetModules();
  const { isServerBetaFeatureEnabled } = await import("./betaFeatureGate");
  expect(isServerBetaFeatureEnabled(ACCOUNT_INBOX_BETA_FEATURE)).toBe(enabled);
});

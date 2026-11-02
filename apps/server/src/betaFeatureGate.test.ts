// FILE: betaFeatureGate.test.ts
// Purpose: Verify the server host's shared feature policy; UI locale has no server mutation RPC.
import { afterEach, expect, it, vi } from "vitest";
import {
  SYNARA_BETA_BUNDLE_ID,
  SYNARA_DESKTOP_BUNDLE_ID_ENV,
  SYNARA_PRODUCTION_BUNDLE_ID,
} from "@synara/shared/desktopIdentity";
import { CHINESE_UI_BETA_FEATURE } from "@synara/shared/betaFeatures";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each(["lattice", "synara"])("gates Beta providers for the %s host", async (host) => {
  vi.stubEnv("AGENT_HOST_PROFILE", host);
  vi.stubEnv(SYNARA_DESKTOP_BUNDLE_ID_ENV, "");
  vi.resetModules();
  const { isServerBetaFeatureEnabled } = await import("./betaFeatureGate.ts");
  expect(isServerBetaFeatureEnabled("omp")).toBe(host !== "lattice");
  expect(isServerBetaFeatureEnabled("codex")).toBe(true);
});

it.each([
  [SYNARA_PRODUCTION_BUNDLE_ID, false],
  [SYNARA_BETA_BUNDLE_ID, true],
] as const)(
  "uses the host bundle identity for Chinese UI feature availability (%s)",
  async (bundleId, enabled) => {
    vi.stubEnv(SYNARA_DESKTOP_BUNDLE_ID_ENV, bundleId);
    vi.resetModules();
    const { isServerBetaFeatureEnabled } = await import("./betaFeatureGate");
    expect(isServerBetaFeatureEnabled(CHINESE_UI_BETA_FEATURE)).toBe(enabled);
  },
);

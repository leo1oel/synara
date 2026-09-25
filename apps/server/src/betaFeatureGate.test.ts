import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each(["lattice", "synara"])("gates Beta providers for the %s host", async (host) => {
  vi.stubEnv("AGENT_HOST_PROFILE", host);
  vi.stubEnv("SYNARA_DESKTOP_BUNDLE_ID", "");
  vi.resetModules();
  const { isServerBetaFeatureEnabled } = await import("./betaFeatureGate.ts");
  expect(isServerBetaFeatureEnabled("omp")).toBe(host !== "lattice");
  expect(isServerBetaFeatureEnabled("codex")).toBe(true);
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { PROVIDER_DESCRIPTORS } from "@synara/shared/providerMetadata";
import { CHINESE_UI_BETA_FEATURE, isBetaFeatureEnabled } from "@synara/shared/betaFeatures";

import { codeEditorEngine, visibleProviderDescriptors } from "./betaFeatures";

afterEach(() => {
  vi.doUnmock("./embedMode");
  vi.resetModules();
});

// Lattice embeds read Stable feature gates (4525aedab). Oh My Pi, the Beta-only feature
// this was written against, ships on Stable since acf63479f, so a feature that is
// still Beta-only shows the gate.
it.each([true, false])("keeps Lattice embeds on Stable feature gates: %s", async (embedded) => {
  vi.resetModules();
  vi.doMock("./embedMode", () => ({ isSynaraEmbedMode: () => embedded }));
  const { isBetaFeatureOn } = await import("./betaFeatures");
  expect(isBetaFeatureOn(CHINESE_UI_BETA_FEATURE)).toBe(!embedded);
  expect(isBetaFeatureOn("codex")).toBe(true);
});

describe("visibleProviderDescriptors", () => {
  it("respects a disabled provider feature", () => {
    const visible = visibleProviderDescriptors((feature) => feature !== "omp");
    expect(visible.some((d) => d.kind === "omp")).toBe(false);
    expect(visible.map((d) => d.kind)).toEqual(
      PROVIDER_DESCRIPTORS.filter((d) => d.kind !== "omp").map((d) => d.kind),
    );
  });

  it("offers Oh My Pi and the other providers in Stable", () => {
    const visible = visibleProviderDescriptors((feature) =>
      isBetaFeatureEnabled(feature, "production"),
    );
    expect(visible).toEqual(PROVIDER_DESCRIPTORS);
  });
});

describe("codeEditorEngine", () => {
  it("uses the native engine in Stable and all other flavors", () => {
    for (const flavor of [
      "production",
      "beta",
      "canary",
      "cua",
      "development",
      "unknown",
    ] as const) {
      expect(codeEditorEngine((feature) => isBetaFeatureEnabled(feature, flavor))).toBe("native");
    }
  });
});

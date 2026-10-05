import { afterEach, describe, expect, it, vi } from "vitest";

import { PROVIDER_DESCRIPTORS } from "@synara/shared/providerMetadata";
import { isBetaFeatureEnabled } from "@synara/shared/betaFeatures";

import { visibleProviderDescriptors } from "./betaFeatures";

afterEach(() => {
  vi.doUnmock("./embedMode");
  vi.resetModules();
});

it.each([true, false])("gates Beta providers for Lattice embeds: %s", async (embedded) => {
  vi.resetModules();
  vi.doMock("./embedMode", () => ({ isSynaraEmbedMode: () => embedded }));
  const { isBetaFeatureOn } = await import("./betaFeatures");
  expect(isBetaFeatureOn("omp")).toBe(!embedded);
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

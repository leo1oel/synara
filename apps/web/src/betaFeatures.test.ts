import { afterEach, describe, expect, it, vi } from "vitest";

import { PROVIDER_DESCRIPTORS } from "@synara/shared/providerMetadata";

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
  it("hides Beta-only providers when the feature is off", () => {
    const visible = visibleProviderDescriptors((feature) => feature !== "omp");
    expect(visible.some((d) => d.kind === "omp")).toBe(false);
    expect(visible.map((d) => d.kind)).toEqual(
      PROVIDER_DESCRIPTORS.filter((d) => d.kind !== "omp").map((d) => d.kind),
    );
  });

  it("returns every provider in order when the feature is on", () => {
    const visible = visibleProviderDescriptors(() => true);
    expect(visible).toEqual(PROVIDER_DESCRIPTORS);
  });
});

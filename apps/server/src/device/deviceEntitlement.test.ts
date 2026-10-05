import { describe, expect, it } from "vitest";

import { isDeviceControlEntitled } from "./deviceEntitlement.ts";

describe("device control entitlement", () => {
  it("keeps standalone Synara device control enabled", () => {
    expect(isDeviceControlEntitled({ AGENT_HOST_PROFILE: "synara" })).toBe(true);
    expect(isDeviceControlEntitled({})).toBe(true);
  });

  it("requires an explicit opt-in from the Lattice host", () => {
    expect(isDeviceControlEntitled({ AGENT_HOST_PROFILE: "lattice" })).toBe(false);
    expect(
      isDeviceControlEntitled({
        AGENT_HOST_PROFILE: "lattice",
        LATTICE_DEVICE_CONTROL_ENABLED: "true",
      }),
    ).toBe(true);
  });

  it("does not treat broad or ambiguous values as an entitlement", () => {
    expect(
      isDeviceControlEntitled({
        AGENT_HOST_PROFILE: "lattice",
        LATTICE_DEVICE_CONTROL_ENABLED: "full-access",
      }),
    ).toBe(false);
  });
});

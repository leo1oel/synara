import { EnvironmentId, type ServerGetEnvironmentResult } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { resolveDeviceSupportStatus } from "./useDeviceSupport";

function environment(
  os: ServerGetEnvironmentResult["platform"]["os"],
  deviceControl: boolean,
): ServerGetEnvironmentResult {
  return {
    environmentId: EnvironmentId.makeUnsafe("environment-device-test"),
    label: "Device test",
    platform: { os, arch: "arm64" },
    serverVersion: "0.7.2",
    capabilities: { repositoryIdentity: true, deviceControl },
  };
}

describe("resolveDeviceSupportStatus", () => {
  it("requires both a macOS server and host entitlement", () => {
    expect(resolveDeviceSupportStatus(environment("darwin", true))).toBe("ready");
    expect(resolveDeviceSupportStatus(environment("darwin", false))).toBe("unauthorized");
    expect(resolveDeviceSupportStatus(environment("linux", true))).toBe("unsupported-platform");
  });

  it("fails closed while server capabilities are loading", () => {
    expect(resolveDeviceSupportStatus(undefined)).toBe("loading");
  });
});

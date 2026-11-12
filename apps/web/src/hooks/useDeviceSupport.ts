// FILE: useDeviceSupport.ts
// Purpose: Report whether the connected server can run device (iOS Simulator) sessions.
// Layer: Web capability hook
// Exports: useDeviceSupport
// Depends on: server environment query

import type { ServerGetEnvironmentResult } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";

import { serverEnvironmentQueryOptions } from "~/lib/serverReactQuery";

export type DeviceSupportStatus = "loading" | "unsupported-platform" | "unauthorized" | "ready";

export function resolveDeviceSupportStatus(
  environment: ServerGetEnvironmentResult | undefined,
): DeviceSupportStatus {
  if (!environment) return "loading";
  if (environment.platform.os !== "darwin") return "unsupported-platform";
  return environment.capabilities.deviceControl ? "ready" : "unauthorized";
}

/**
 * The simulator engine lives in apps/server and shells out to the user's Xcode,
 * so support follows the server's platform and host-owned entitlement, not the
 * browser's OS or the provider's broad runtime mode. Until the environment
 * resolves this is false, which keeps the add-menu entry from flickering on a
 * cold start.
 */
export function useDeviceSupport(): boolean {
  const environmentQuery = useQuery(serverEnvironmentQueryOptions());
  return resolveDeviceSupportStatus(environmentQuery.data) === "ready";
}

/**
 * Host-owned entitlement for agent and embedded-UI device control.
 *
 * Standalone Synara owns its device surface and keeps the upstream default.
 * An embedding host must opt in explicitly so selecting a broad provider
 * runtime mode cannot silently grant simulator control.
 */
export function isDeviceControlEntitled(environment: NodeJS.ProcessEnv = process.env): boolean {
  const hostProfile = (
    environment.AGENT_HOST_PROFILE ??
    environment.SYNARA_HOST_PROFILE ??
    "synara"
  )
    .trim()
    .toLowerCase();
  if (hostProfile !== "lattice") return true;
  return environment.LATTICE_DEVICE_CONTROL_ENABLED?.trim().toLowerCase() === "true";
}

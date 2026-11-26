/**
 * providerCliOutput - Pure helpers for interpreting provider CLI probe output.
 *
 * Shared by the provider health checks in ProviderHealth: shapes captured
 * process output and walks arbitrary auth-status JSON for common markers.
 * No process spawning and no effect dependencies live here.
 */

export const PROVIDER_COMMAND_TIMEOUT_DETAIL = "Timed out while running command.";

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export function nonEmptyTrimmed(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const COMMAND_MISSING_MARKERS = ["enoent", "notfound", "command not found"] as const;

export function isCommandMissingCause(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return COMMAND_MISSING_MARKERS.some((marker) => lower.includes(marker));
}

// CSI sequences (colours, cursor moves) and OSC sequences (hyperlinks, titles). CLIs
// colour their stderr when FORCE_COLOR is set, even into a pipe, and that text ends up
// verbatim in provider status messages.
// eslint-disable-next-line no-control-regex -- stripping terminal escape codes is the point
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE, "");
}

export function detailFromResult(
  result: CommandResult & { readonly timedOut?: boolean },
): string | undefined {
  if (result.timedOut) return PROVIDER_COMMAND_TIMEOUT_DETAIL;
  const stderr = nonEmptyTrimmed(stripAnsi(result.stderr));
  if (stderr) return stderr;
  const stdout = nonEmptyTrimmed(stripAnsi(result.stdout));
  if (stdout) return stdout;
  if (result.code !== 0) {
    return `Command exited with code ${result.code}.`;
  }
  return undefined;
}

export function extractAuthBoolean(value: unknown): boolean | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractAuthBoolean(entry);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }

  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["authenticated", "isAuthenticated", "loggedIn", "isLoggedIn"] as const) {
    if (typeof record[key] === "boolean") return record[key];
  }
  for (const key of ["auth", "status", "session", "account"] as const) {
    const nested = extractAuthBoolean(record[key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function extractAuthMethod(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractAuthMethod(entry);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }

  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["authMethod", "auth_type", "authType"] as const) {
    if (typeof record[key] === "string") {
      const trimmed = record[key].trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  for (const key of ["auth", "status", "session", "account"] as const) {
    const nested = extractAuthMethod(record[key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function toTitleCaseWords(value: string): string {
  return value
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

// FILE: mcpServerStatus.ts
// Purpose: Normalize each provider runtime's own MCP status report into the
//          `/mcp` view's descriptor, so the web never re-parses config files.
// Layer: Provider runtime utility
// Exports: Claude and Codex status mappers.

import type {
  ProviderMcpServerAction,
  ProviderMcpServerDescriptor,
  ProviderMcpServerStatus,
  ProviderMcpServerTransport,
} from "@synara/contracts";

const MAX_ERROR_LENGTH = 500;

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function boundedError(value: unknown): string | undefined {
  const text = nonEmpty(value);
  return text && text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text;
}

// Only the origin: paths and queries can carry tokens or tenant identifiers.
function httpOrigin(url: unknown): string | undefined {
  const text = nonEmpty(url);
  if (!text) return undefined;
  try {
    return new URL(text).origin;
  } catch {
    return undefined;
  }
}

// Only the executable's name: arguments and absolute paths can carry secrets.
function commandName(command: unknown): string | undefined {
  const text = nonEmpty(command);
  if (!text) return undefined;
  return text.split(/[\\/]/).pop() || undefined;
}

function serverActions(input: {
  readonly status: ProviderMcpServerStatus;
  readonly transport: ProviderMcpServerTransport;
  readonly canToggle: boolean;
}): ProviderMcpServerAction[] {
  const actions: ProviderMcpServerAction[] = [];
  if (input.status === "needs-auth" && input.transport !== "stdio") {
    actions.push("authenticate");
  }
  if (input.status !== "disabled") {
    actions.push("reconnect");
  }
  if (input.canToggle) {
    actions.push(input.status === "disabled" ? "enable" : "disable");
  }
  return actions;
}

// Connected first, then the servers that need the user, then the rest, by name.
const STATUS_ORDER: Record<ProviderMcpServerStatus, number> = {
  "needs-auth": 0,
  failed: 1,
  pending: 2,
  connected: 3,
  disabled: 4,
};

function sortServers(servers: ProviderMcpServerDescriptor[]): ProviderMcpServerDescriptor[] {
  return servers.toSorted(
    (left, right) =>
      STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || left.name.localeCompare(right.name),
  );
}

/** The subset of the Claude Agent SDK's `McpServerStatus` this view reads. */
export interface ClaudeMcpServerStatusLike {
  readonly name: string;
  readonly status: string;
  readonly error?: string | undefined;
  readonly scope?: string | undefined;
  readonly source?: string | undefined;
  readonly config?: { readonly type?: string; readonly url?: string; readonly command?: string };
  readonly tools?: ReadonlyArray<unknown> | undefined;
}

function claudeStatus(status: string): ProviderMcpServerStatus {
  switch (status) {
    case "connected":
    case "failed":
    case "needs-auth":
    case "disabled":
      return status;
    default:
      return "pending";
  }
}

function claudeTransport(type: string | undefined): ProviderMcpServerTransport {
  if (type === undefined || type === "stdio") return "stdio";
  if (type === "http" || type === "claudeai-proxy") return "http";
  if (type === "sse" || type === "sse-ide") return "sse";
  return "other";
}

/**
 * The gateway Synara injects into every session is part of the app, not a
 * server the user configured, so the view leaves it out: disabling it would
 * cut the agent off from the app.
 */
export function mapClaudeMcpServerStatuses(
  statuses: ReadonlyArray<ClaudeMcpServerStatusLike>,
  gatewayServerName: string,
): ProviderMcpServerDescriptor[] {
  const servers: ProviderMcpServerDescriptor[] = [];
  for (const entry of statuses) {
    const name = nonEmpty(entry.name);
    if (!name) continue;
    const origin = entry.source ?? entry.scope;
    if (name === gatewayServerName && origin !== "user" && origin !== "project") continue;
    const status = claudeStatus(entry.status);
    const transport = claudeTransport(entry.config?.type);
    const error = status === "failed" ? boundedError(entry.error) : undefined;
    const scope = nonEmpty(entry.scope);
    const endpoint =
      transport === "stdio" ? commandName(entry.config?.command) : httpOrigin(entry.config?.url);
    servers.push({
      name,
      status,
      transport,
      toolCount: status === "connected" ? (entry.tools?.length ?? 0) : null,
      ...(error ? { error } : {}),
      ...(scope ? { scope } : {}),
      ...(endpoint ? { endpoint } : {}),
      // Plugin servers belong to their plugin; Claude refuses to toggle them alone.
      actions: serverActions({ status, transport, canToggle: entry.source !== "plugin" }),
    });
  }
  return sortServers(servers);
}

/**
 * Codex `mcpServerStatus/list` entries. `runtimeStatus` is only known for a
 * thread's own connection; without one, the tool listing and auth state say
 * whether the server answered.
 */
export function mapCodexMcpServerStatuses(
  entries: ReadonlyArray<unknown>,
  input: { readonly gatewayServerName: string; readonly disabledServerNames: ReadonlySet<string> },
): ProviderMcpServerDescriptor[] {
  const servers: ProviderMcpServerDescriptor[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const name = nonEmpty(entry.name);
    if (!name || name === input.gatewayServerName) continue;
    const origin = httpOrigin(entry.httpOrigin);
    const transport: ProviderMcpServerTransport = origin ? "http" : "stdio";
    const tools =
      entry.tools && typeof entry.tools === "object" ? Object.keys(entry.tools).length : 0;
    const toolsError = boundedError(entry.toolsError);
    const authStatus = nonEmpty(entry.authStatus);
    let status: ProviderMcpServerStatus;
    switch (entry.runtimeStatus) {
      case "connected":
        status = "connected";
        break;
      case "authenticationRequired":
        status = "needs-auth";
        break;
      case "failed":
      case "cancelled":
        status = "failed";
        break;
      case "disabled":
        status = "disabled";
        break;
      case "starting":
      case "notStarted":
        status = "pending";
        break;
      default:
        status = input.disabledServerNames.has(name)
          ? "disabled"
          : authStatus === "notLoggedIn"
            ? "needs-auth"
            : toolsError
              ? "failed"
              : "connected";
    }
    servers.push({
      name,
      status,
      transport,
      toolCount: status === "connected" ? tools : null,
      ...(status === "failed" && toolsError ? { error: toolsError } : {}),
      ...(origin ? { endpoint: origin } : {}),
      // Codex keeps enablement in config.toml only (see runMcpServerAction).
      actions: serverActions({ status, transport, canToggle: false }),
    });
  }
  return sortServers(servers);
}

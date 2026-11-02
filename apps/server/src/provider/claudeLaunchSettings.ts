// FILE: claudeLaunchSettings.ts
// Purpose: The server settings Claude Code is spawned with outside its provider options.
// Layer: Server provider runtime

import { Effect, Option } from "effect";
import { providerProcessPriorityEnabled } from "../providerProcessPriority";
import { ServerSettingsService } from "../serverSettings";

// Optional for standalone runtimes/tests; a missing or unreadable setting keeps
// the fast default (Lattice's own MCP server only).
const claudeUserMcpServersEnabled: Effect.Effect<boolean> = Effect.gen(function* () {
  const service = yield* Effect.serviceOption(ServerSettingsService);
  if (Option.isNone(service)) return false;
  return yield* service.value.getSettings.pipe(
    Effect.map((settings) => settings.providers.claudeAgent.loadUserMcpServers),
    Effect.catch((cause) =>
      Effect.logWarning("Failed to read the Claude MCP server setting", cause).pipe(
        Effect.as(false),
      ),
    ),
  );
});

export interface ClaudeLaunchSettings {
  /** Lattice only: whether Claude also loads the user's own MCP servers. */
  readonly loadUserMcpServers: boolean;
  readonly lowerProcessPriority: boolean;
}

/**
 * Every setting the Claude adapter reads when it spawns Claude Code, rather
 * than through the thread's provider options. A runtime spawned under other
 * values is not the one a start would spawn now, so the provider command
 * reactor adopts a warm draft only while these still match. A new setting
 * the adapter reads at spawn belongs here, or a warm draft ignores it.
 */
export const readClaudeLaunchSettings: Effect.Effect<ClaudeLaunchSettings> = Effect.all({
  loadUserMcpServers: claudeUserMcpServersEnabled,
  lowerProcessPriority: providerProcessPriorityEnabled,
});

export const claudeLaunchSettingsEqual = (
  left: ClaudeLaunchSettings,
  right: ClaudeLaunchSettings,
): boolean =>
  (Object.keys(left) as Array<keyof ClaudeLaunchSettings>).every((key) => left[key] === right[key]);

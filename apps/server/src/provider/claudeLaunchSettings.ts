// FILE: claudeLaunchSettings.ts
// Purpose: The server settings Claude Code is spawned with outside its provider options.
// Layer: Server provider runtime

import { Effect, Option } from "effect";
import { providerProcessPriorityEnabled } from "../providerProcessPriority";
import { ServerSettingsService } from "../serverSettings";
import { skillNameKey } from "./skillsCatalog";

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

// Normalized (case-folded, deduped, sorted) so two reads of the same Settings
// compare equal however the names were typed or ordered. Unreadable settings
// serve every skill: hiding one the user never turned off is the worse miss.
const claudeDisabledSkillNames: Effect.Effect<ReadonlyArray<string>> = Effect.gen(function* () {
  const service = yield* Effect.serviceOption(ServerSettingsService);
  if (Option.isNone(service)) return [];
  return yield* service.value.getSettings.pipe(
    Effect.map((settings) => [...new Set(settings.skills.disabled.map(skillNameKey))].toSorted()),
    Effect.catch((cause) =>
      Effect.logWarning("Failed to read the disabled skills setting", cause).pipe(
        Effect.as([] as ReadonlyArray<string>),
      ),
    ),
  );
});

export interface ClaudeLaunchSettings {
  /** Lattice only: whether Claude also loads the user's own MCP servers. */
  readonly loadUserMcpServers: boolean;
  readonly lowerProcessPriority: boolean;
  /** Skills Settings turned off; they stay out of the session's skills plugin. */
  readonly disabledSkillNames: ReadonlyArray<string>;
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
  disabledSkillNames: claudeDisabledSkillNames,
});

export const claudeLaunchSettingsEqual = (
  left: ClaudeLaunchSettings,
  right: ClaudeLaunchSettings,
): boolean =>
  left.loadUserMcpServers === right.loadUserMcpServers &&
  left.lowerProcessPriority === right.lowerProcessPriority &&
  left.disabledSkillNames.length === right.disabledSkillNames.length &&
  left.disabledSkillNames.every((name, index) => name === right.disabledSkillNames[index]);

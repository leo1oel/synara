// FILE: claudeUserMcpSetting.ts
// Purpose: Reads whether Lattice's Claude sessions load the user's own MCP servers.
// Layer: Server provider runtime

import { Effect, Option } from "effect";
import { ServerSettingsService } from "../serverSettings";

// Optional for standalone runtimes/tests; a missing or unreadable setting keeps
// the fast default (Lattice's own MCP server only).
export const claudeUserMcpServersEnabled: Effect.Effect<boolean> = Effect.gen(function* () {
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

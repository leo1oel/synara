import { compareSemverVersions } from "./providerMaintenance.ts";

// The oldest Claude Code that accepts every flag the pinned Agent SDK passes.
// Bisected against npm releases with Synara's real launch arguments: 2.0.0
// rejects --allow-dangerously-skip-permissions (Full access), 2.0.62 still
// rejects --no-session-persistence (Synara's probes), and 2.0.63 accepts them
// all and answers a turn through the pinned SDK. Older ones exit 1 at startup.
export const MINIMUM_CLAUDE_SDK_CLI_VERSION = "2.0.63";

export function isClaudeCliTooOldForSdk(version: string): boolean {
  return compareSemverVersions(version, MINIMUM_CLAUDE_SDK_CLI_VERSION) < 0;
}

// Auto permission mode required `--enable-auto-mode` (never passed by Synara) before 2.1.111.
export const MINIMUM_CLAUDE_AUTO_MODE_CLI_VERSION = "2.1.111";

export function isClaudeAutoModeCliVersionSupported(version: string | null): boolean {
  return (
    version !== null && compareSemverVersions(version, MINIMUM_CLAUDE_AUTO_MODE_CLI_VERSION) >= 0
  );
}

/** The provider-status message for an outdated CLI; the web localizes it by shape. */
export function claudeCliTooOldMessage(version: string): string {
  return `Claude Code ${version} is too old. Run \`claude update\` in Terminal.`;
}

// FILE: nativeSessionHandoff.ts
// Purpose: Lattice's "Continue in terminal": the shell command that continues a chat's
//          native Codex thread or Claude Code session outside Synara.
// Layer: Server orchestration
//
// Codex lists Lattice threads in `codex resume`, but Claude Code hides Agent SDK sessions
// from its picker and `--continue`; `claude --resume <id>` is the only way back in, so
// the command names the id outright for both agents.

import nodePath from "node:path";

import type { ProjectImportProvider } from "@synara/contracts";

/** POSIX shells: single quotes keep every byte; an embedded quote is closed and escaped. */
function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** PowerShell: inside single quotes only the quote itself is special, written twice. */
function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

// Native ids are UUID-like; anything else is quoted rather than trusted.
const BARE_SHELL_WORD = /^[A-Za-z0-9._:-]+$/;

export interface NativeSessionResumeCommandInput {
  readonly provider: ProjectImportProvider;
  readonly nativeId: string;
  readonly cwd: string;
  /**
   * The account's store when it is not the one a plain terminal uses (`~/.claude`,
   * `~/.codex`): Claude's CLAUDE_CONFIG_DIR or Codex's CODEX_HOME. Without it the
   * terminal would look for the session in the wrong store.
   */
  readonly storeOverride?: string | undefined;
  readonly platform: NodeJS.Platform;
}

export function buildNativeSessionResumeCommand(input: NativeSessionResumeCommandInput): string {
  const powerShell = input.platform === "win32";
  const quote = powerShell ? quotePowerShell : quotePosix;
  const id = BARE_SHELL_WORD.test(input.nativeId) ? input.nativeId : quote(input.nativeId);
  const resume = input.provider === "codex" ? `codex resume ${id}` : `claude --resume ${id}`;
  const storeVariable = input.provider === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR";
  if (powerShell) {
    // Windows PowerShell 5.1 has no `&&`; `;` runs on, so a failed cd must stop it.
    const store = input.storeOverride
      ? `$env:${storeVariable} = ${quote(input.storeOverride)}; `
      : "";
    return `Set-Location -LiteralPath ${quote(input.cwd)} -ErrorAction Stop; ${store}${resume}`;
  }
  const store = input.storeOverride ? `${storeVariable}=${quote(input.storeOverride)} ` : "";
  return `cd ${quote(input.cwd)} && ${store}${resume}`;
}

/** The store a plain terminal's agent reads when no environment variable selects one. */
export function defaultNativeSessionStore(
  provider: ProjectImportProvider,
  homeDir: string,
): string {
  return nodePath.join(homeDir, provider === "codex" ? ".codex" : ".claude");
}

// FILE: providerStatusMessages.ts
// Purpose: Translate the fixed provider health and usage messages the server sends as plain
//   English (`ServerProviderStatus.message`, usage snapshot `detail`). The server stays
//   locale-free; anything not listed here (raw CLI errors, paths, versions) passes through.
// Layer: Web presentation helper

import type { I18n } from "@lingui/core";

export function localizeProviderStatusMessage(i18n: I18n, message: string): string {
  switch (message) {
    case "Codex CLI is not authenticated. Run `codex login` and try again.":
      return i18n._("Codex CLI is not authenticated. Run `codex login` and try again.");
    case "Codex CLI (`codex`) is not installed or not on PATH.":
      return i18n._("Codex CLI (`codex`) is not installed or not on PATH.");
    case "Codex CLI authentication status command is unavailable in this Codex version.":
      return i18n._(
        "Codex CLI authentication status command is unavailable in this Codex version.",
      );
    case "Codex CLI is installed but failed to run. Timed out while running command.":
      return i18n._("Codex CLI is installed but failed to run. Timed out while running command.");
    case "Could not verify Codex authentication status.":
      return i18n._("Could not verify Codex authentication status.");
    case "Could not verify Codex authentication status. Timed out while running command.":
      return i18n._(
        "Could not verify Codex authentication status. Timed out while running command.",
      );
    case "Using a custom Codex model provider; OpenAI login check skipped.":
      return i18n._("Using a custom Codex model provider; OpenAI login check skipped.");
    case "Claude is not authenticated. Run `claude auth login` and try again.":
      return i18n._("Claude is not authenticated. Run `claude auth login` and try again.");
    case "Claude Agent CLI (`claude`) is not installed or not on PATH.":
      return i18n._("Claude Agent CLI (`claude`) is not installed or not on PATH.");
    case "Claude Agent CLI is installed but failed to run. Timed out while running command.":
      return i18n._(
        "Claude Agent CLI is installed but failed to run. Timed out while running command.",
      );
    case "Could not verify Claude authentication status. Timed out while running command.":
      return i18n._(
        "Could not verify Claude authentication status. Timed out while running command.",
      );
    case "Cursor Agent is not authenticated. Run `cursor-agent login` and try again.":
      return i18n._("Cursor Agent is not authenticated. Run `cursor-agent login` and try again.");
    // Usage snapshot details (apps/server/src/providerUsage).
    case "Sign in with the provider CLI to see usage.":
      return i18n._("Sign in with the provider CLI to see usage.");
    case "Codex API-key auth has no usage endpoint. Sign in with ChatGPT to see usage.":
      return i18n._("Codex API-key auth has no usage endpoint. Sign in with ChatGPT to see usage.");
    case "Could not reach the Codex usage endpoint.":
      return i18n._("Could not reach the Codex usage endpoint.");
    case "Live usage is not available for this provider configuration.":
      return i18n._("Live usage is not available for this provider configuration.");
    case "Usage is currently unavailable.":
      return i18n._("Usage is currently unavailable.");
    default: {
      const signIn = /^Sign in with `([^`]+)` to see usage\.$/u.exec(message);
      if (signIn) return i18n._("Sign in with `{command}` to see usage.", { command: signIn[1]! });
      const failed = /^Codex usage request failed \((\d+)\)\.$/u.exec(message);
      if (failed) return i18n._("Codex usage request failed ({status}).", { status: failed[1]! });
      return message;
    }
  }
}

import { t } from "~/i18n";

export function localizeProviderStatusMessage(translate: typeof t, message: string): string {
  switch (message) {
    case "Codex CLI is not authenticated. Run `codex login` and try again.":
      return translate("lattice:codexCLIIsNotAuthenticatedRunCodex");
    case "Codex CLI (`codex`) is not installed or not on PATH.":
      return translate("lattice:codexCLICodexIsNotInstalledOr");
    case "Codex CLI authentication status command is unavailable in this Codex version.":
      return translate("lattice:codexCLIAuthenticationStatusCommandIsUnavailable");
    case "Codex CLI is installed but failed to run. Timed out while running command.":
      return translate("lattice:codexCLIIsInstalledButFailedTo");
    case "Could not verify Codex authentication status.":
      return translate("lattice:couldNotVerifyCodexAuthenticationStatus");
    case "Could not verify Codex authentication status. Timed out while running command.":
      return translate("lattice:couldNotVerifyCodexAuthenticationStatusTimed");
    case "Using a custom Codex model provider; OpenAI login check skipped.":
      return translate("lattice:usingACustomCodexModelProviderOpenAI");
    case "Claude is not authenticated. Run `claude auth login` and try again.":
      return translate("lattice:claudeIsNotAuthenticatedRunClaudeAuth");
    case "Claude Agent CLI (`claude`) is not installed or not on PATH.":
      return translate("lattice:claudeAgentCLIClaudeIsNotInstalled");
    case "Claude Agent CLI is installed but failed to run. Timed out while running command.":
      return translate("lattice:claudeAgentCLIIsInstalledButFailed");
    case "Could not verify Claude authentication status. Timed out while running command.":
      return translate("lattice:couldNotVerifyClaudeAuthenticationStatusTimed");
    // Provider runtimes a slim host installs on demand (apps/server/src/provider/providerRuntimes.ts).
    case "Pi is not installed. Install Pi in provider settings to use it.":
      return translate("lattice:piIsNotInstalledInstallPiIn");
    case "OpenCode is not installed. Install OpenCode in provider settings to use it.":
      return translate("lattice:openCodeIsNotInstalledInstallOpenCodeIn");
    case "Cursor Agent is not authenticated. Run `cursor-agent login` and try again.":
      return translate("lattice:cursorAgentIsNotAuthenticatedRunCursor");
    // Usage snapshot details (apps/server/src/providerUsage).
    case "Sign in with the provider CLI to see usage.":
      return translate("settings:usageSignInProviderCli");
    case "Codex API-key auth has no usage endpoint. Sign in with ChatGPT to see usage.":
      return translate("lattice:codexAPIKeyAuthHasNoUsage");
    case "Could not reach the Codex usage endpoint.":
      return translate("lattice:couldNotReachTheCodexUsageEndpoint");
    case "Live usage is not available for this provider configuration.":
      return translate("common:liveUsageIsNotAvailableForThisProviderConfiguration");
    case "Usage is currently unavailable.":
      return translate("common:usageIsCurrentlyUnavailable");
    case "Live usage is unavailable for environment-token authentication. Tokens from `claude setup-token` support chats but do not include the user:profile scope needed for usage.":
      return translate("lattice:liveUsageIsUnavailableForEnvironmentToken");
    case "No Claude usage credentials were found. A token supplied by a wrapper may support chats without access to usage. Sign in with `claude auth login` for this account to enable usage.":
      return translate("lattice:noClaudeUsageCredentialsWereFoundA");
    case "This Claude login cannot report usage: its token lacks the user:profile scope. Tokens from `claude setup-token` can still be used for chats.":
      return translate("lattice:thisClaudeLoginCannotReportUsageIts");
    default: {
      const signIn = /^Sign in with `([^`]+)` to see usage\.$/u.exec(message);
      if (signIn) return translate("settings:usageSignInCommand", { command: signIn[1]! });
      const piNotSetUp =
        /^Pi is not set up\. Install the Pi CLI \(`pi`\) or add Pi credentials to (.+) to use the Pi provider\.$/u.exec(
          message,
        );
      if (piNotSetUp)
        return translate("lattice:piIsNotSetUpInstallThe", { agentDir: piNotSetUp[1]! });
      const failed = /^Codex usage request failed \((\d+)\)\.$/u.exec(message);
      if (failed) return translate("lattice:codexUsageRequestFailed", { status: failed[1]! });
      return message;
    }
  }
}

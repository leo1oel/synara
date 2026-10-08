import { i18n } from "~/i18n";
import type { ServerProviderStatus } from "@synara/contracts";

/** Installation/auth health is independent of permission to run background work. */
export function providerSetupStatusLabel(input: {
  readonly status: ServerProviderStatus | undefined;
  readonly reconciled: boolean;
  readonly disabled: boolean;
}): string {
  if (input.disabled) return i18n._("Disabled · enable to check setup");
  if (!input.reconciled || !input.status) return i18n._("Checking setup");
  const status = input.status;
  // Missing CLIs and failed probes both report available=false. The server's
  // message supplies the specific diagnosis alongside this label in Settings.
  if (!status.available) return i18n._("Unavailable");
  if (status.authStatus === "unauthenticated") return i18n._("Needs sign-in");
  if (status.status !== "ready") return i18n._("Needs attention");
  if (status.authStatus === "unknown") return i18n._("Installed · sign-in not verified");
  return i18n._("Connected");
}

export type ProviderAccountStatusTone = "ready" | "warning" | "error" | "idle";

export interface ProviderAccountStatusSummary {
  readonly tone: ProviderAccountStatusTone;
  /** Short state title shown on the account's row. */
  readonly headline: string;
  /** The server's diagnosis, when it adds something the headline does not say. */
  readonly detail: string | null;
}

// One title per account row. The local switch wins over a stale status: an account that
// was just turned off reads "Disabled" before the server reports it.
export function providerAccountStatusSummary(input: {
  readonly status: ServerProviderStatus | undefined;
  readonly enabled: boolean;
}): ProviderAccountStatusSummary {
  if (!input.enabled) {
    return { tone: "idle", headline: i18n._("Disabled"), detail: null };
  }
  const status = input.status;
  if (!status) {
    return { tone: "idle", headline: i18n._("Checking account status"), detail: null };
  }
  const detail = status.message?.trim() || null;
  if (!status.available) {
    return { tone: "error", headline: i18n._("Unavailable"), detail };
  }
  if (status.authStatus === "unauthenticated") {
    return { tone: "warning", headline: i18n._("Not authenticated"), detail };
  }
  if (status.status === "error") {
    return { tone: "error", headline: i18n._("Unavailable"), detail };
  }
  if (status.status === "warning") {
    return { tone: "warning", headline: i18n._("Needs attention"), detail };
  }
  if (status.authStatus === "authenticated") {
    const authLabel = status.authLabel?.trim() || status.authType?.trim();
    return {
      tone: "ready",
      headline: authLabel
        ? i18n._("Authenticated · {account}", { account: authLabel })
        : i18n._("Authenticated"),
      detail,
    };
  }
  return { tone: "ready", headline: i18n._("Available"), detail };
}

import type { OrchestrationThreadActivity } from "@synara/contracts";
import { i18n } from "~/i18n";

/** Why a requested fast mode is not the speed the thread is getting. */
export interface FastModeNotice {
  readonly kind: "blocked" | "cooldown";
  /** Short value shown where the selection would read "Fast". */
  readonly label: string;
  /** Full sentence for tooltips and menu notes. */
  readonly detail: string;
}

// These reasons mean "not requested yet" rather than "refused": the last report
// predates the toggle, so the requested option is still the best signal.
const NOT_REQUESTED_REASONS = new Set(["sdk_opt_in_required", "preference", "pending"]);

function blockedDetail(reason: string): string | null {
  switch (reason) {
    case "extra_usage_disabled":
      return i18n._("usage credits are turned off for this Claude account");
    case "free":
      return i18n._("this Claude plan does not include it");
    case "not_first_party":
      return i18n._("it needs a first-party Anthropic account");
    case "disabled_by_env":
      return i18n._("it is disabled in this environment");
    case "model_not_allowed":
      return i18n._("this model does not support it");
    case "network_error":
      return i18n._("Claude could not check its availability");
    default:
      return null;
  }
}

export const FAST_MODE_STATE_ACTIVITY_KIND = "fast-mode.state";

// Read the fast-mode state the provider last reported for the thread. Returns
// null when fast mode is serving requests or nothing contradicts the request.
export function deriveFastModeNotice(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): FastModeNotice | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]!;
    // A successful handoff starts a different session/account. An older SDK
    // may never report its state, so the previous account is no longer evidence.
    if (activity.kind === "provider.handoff") return null;
    if (activity.kind === FAST_MODE_STATE_ACTIVITY_KIND)
      return fastModeNoticeFromActivity(activity);
  }
  return null;
}

export function fastModeNoticeFromActivity(
  activity: OrchestrationThreadActivity | null | undefined,
): FastModeNotice | null {
  const payload =
    activity?.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  if (payload?.state === "cooldown") {
    return {
      kind: "cooldown",
      label: i18n._("Fast paused"),
      detail: i18n._(
        "Fast mode is paused after a rate limit. Requests run at standard speed for now.",
      ),
    };
  }
  if (payload?.state !== "off") {
    return null;
  }
  const reason = typeof payload.disabledReason === "string" ? payload.disabledReason : null;
  if (reason === null || NOT_REQUESTED_REASONS.has(reason)) {
    return null;
  }
  const cause = blockedDetail(reason) ?? i18n._("Claude reported it as unavailable");
  return {
    kind: "blocked",
    label: i18n._("Fast unavailable"),
    detail: i18n._("Fast mode is not active: {cause}. Requests run at standard speed.", { cause }),
  };
}

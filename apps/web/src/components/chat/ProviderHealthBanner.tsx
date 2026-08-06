// FILE: ProviderHealthBanner.tsx
// Purpose: Surfaces provider availability warnings above the active chat.
// Layer: Chat status presentation
// Exports: ProviderHealthBanner

import { PROVIDER_DISPLAY_NAMES, type ServerProviderStatus } from "@synara/contracts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import {
  EXPANDED_NOTIFICATION_SURFACE_CLASS_NAME,
  NOTIFICATION_ICON_CLASS_NAME,
} from "../ui/notificationSurface";
import { CircleAlertIcon, TriangleAlertIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ChatColumnBannerFrame } from "./ChatColumnBannerFrame";

export const ProviderHealthBanner = function ProviderHealthBanner({
  needsProviderSetup = false,
  onConfigure,
  onDismiss,
  status,
}: {
  needsProviderSetup?: boolean;
  onConfigure?: () => void;
  onDismiss?: () => void;
  status: ServerProviderStatus | null;
}) {
  if (!needsProviderSetup && (!status || status.status === "ready")) {
    return null;
  }

  const providerLabel = status
    ? (PROVIDER_DISPLAY_NAMES[status.provider] ?? status.provider)
    : null;
  const defaultMessage = needsProviderSetup
    ? "Install or sign in to at least one provider before starting an agent chat."
    : status?.status === "error"
      ? `${providerLabel} provider is unavailable.`
      : `${providerLabel} provider has limited availability.`;
  const message = needsProviderSetup ? defaultMessage : (status?.message ?? defaultMessage);
  const title = needsProviderSetup
    ? "Set up an agent provider"
    : `${providerLabel} provider status`;
  const isError = status?.status === "error";
  const Icon = isError ? CircleAlertIcon : TriangleAlertIcon;

  return (
    <ChatColumnBannerFrame>
      <Alert
        className={cn(
          EXPANDED_NOTIFICATION_SURFACE_CLASS_NAME,
          !onConfigure && onDismiss && "pr-10",
        )}
        variant={needsProviderSetup ? "info" : isError ? "error" : "warning"}
      >
        <Icon className={NOTIFICATION_ICON_CLASS_NAME} />
        <AlertTitle className="font-normal text-[var(--notification-fg)]">{title}</AlertTitle>
        <AlertDescription className="line-clamp-3 text-[var(--notification-fg)]/72" title={message}>
          {message}
        </AlertDescription>
        {onConfigure || onDismiss ? (
          <AlertAction className={cn("items-center", !onConfigure && "absolute top-2 right-2")}>
            {onConfigure ? (
              <Button size="xs" variant="outline" onClick={onConfigure}>
                Provider settings
              </Button>
            ) : null}
            {onDismiss ? (
              <IconButton
                className="size-6 rounded-full text-[var(--notification-fg)]/65 hover:bg-[var(--notification-fg)]/10 hover:text-[var(--notification-fg)] focus-visible:ring-[var(--notification-fg)]/35 sm:size-6"
                label="Dismiss provider status"
                title="Dismiss provider status"
                onClick={onDismiss}
              >
                <XIcon className="size-3.5" />
              </IconButton>
            ) : null}
          </AlertAction>
        ) : null}
      </Alert>
    </ChatColumnBannerFrame>
  );
};

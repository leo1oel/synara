// FILE: ThreadErrorBanner.tsx
// Purpose: Surfaces dismissible thread-level runtime errors — inline above the
//          transcript standalone, via the host's notification stack when embedded.
// Layer: Chat status presentation
// Exports: ThreadErrorBanner

import { isProviderDeliveryBlockDetail } from "@synara/shared/providerDeliveryBlock";
import { useEffect, useRef } from "react";

import { readEmbedMode } from "../../embedMode";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { toastManager } from "../ui/toast";
import { CircleAlertIcon, XIcon } from "~/lib/icons";
import { ChatColumnBannerFrame } from "./ChatColumnBannerFrame";

export function ThreadErrorBanner({
  error,
  onDismiss,
  onUnblock,
  unblocking = false,
}: {
  error: string | null;
  onDismiss?: () => void;
  /** Recovery action offered only when the error is a provider-delivery quarantine. */
  onUnblock?: () => void;
  unblocking?: boolean;
}) {
  if (!error) return null;
  const canUnblock = onUnblock !== undefined && isProviderDeliveryBlockDetail(error);
  // When a host application embeds the panel, thread errors join the host's
  // window-level notification stack (via the embedded toast bridge) so every
  // error surfaces in one place instead of a banner buried in the transcript.
  if (readEmbedMode()?.hostOrigin) {
    return (
      <ThreadErrorHostToast
        error={error}
        canUnblock={canUnblock}
        unblocking={unblocking}
        onDismiss={onDismiss}
        onUnblock={onUnblock}
      />
    );
  }
  return (
    <ChatColumnBannerFrame>
      <Alert variant="error">
        <CircleAlertIcon />
        <AlertDescription className="line-clamp-3" title={error}>
          {error}
        </AlertDescription>
        {canUnblock || onDismiss ? (
          <AlertAction className="items-center">
            {canUnblock ? (
              <Button
                size="xs"
                variant="destructive-outline"
                disabled={unblocking}
                onClick={onUnblock}
              >
                {unblocking ? "Unblocking…" : "Unblock thread"}
              </Button>
            ) : null}
            {onDismiss ? (
              <IconButton
                label="Dismiss error"
                className="size-6 text-destructive/60 hover:text-destructive sm:size-6"
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
}

// Mirrors the active thread error into one persistent toast: mounted while an
// error exists, updated in place as it changes, closed on clear/unmount. Host
// dismissal comes back through the bridge as `data.onClose`.
function ThreadErrorHostToast({
  error,
  canUnblock,
  unblocking,
  onDismiss,
  onUnblock,
}: {
  error: string;
  canUnblock: boolean;
  unblocking: boolean;
  onDismiss?: (() => void) | undefined;
  onUnblock?: (() => void) | undefined;
}) {
  const toastIdRef = useRef<ReturnType<typeof toastManager.add> | null>(null);
  useEffect(() => {
    const payload = {
      type: "error" as const,
      title: error,
      // Never time out under an unresolved error: the toast lives until the
      // user dismisses it or the thread error clears (which unmounts us).
      timeout: 0,
      data: {
        copyText: error,
        ...(onDismiss ? { onClose: onDismiss } : {}),
      },
      ...(canUnblock && onUnblock
        ? {
            actionProps: {
              children: unblocking ? "Unblocking…" : "Unblock thread",
              disabled: unblocking,
              onClick: onUnblock,
            },
          }
        : {}),
    };
    if (toastIdRef.current === null) {
      toastIdRef.current = toastManager.add(payload);
    } else {
      toastManager.update(toastIdRef.current, payload);
    }
  }, [canUnblock, error, onDismiss, onUnblock, unblocking]);
  useEffect(
    () => () => {
      if (toastIdRef.current !== null) {
        toastManager.close(toastIdRef.current);
        toastIdRef.current = null;
      }
    },
    [],
  );
  return null;
}

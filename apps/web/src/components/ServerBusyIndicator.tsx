import { useEffect, useState, useSyncExternalStore } from "react";
import { i18n } from "~/i18n";
import {
  getServerBusySnapshot,
  subscribeServerBusy,
  type ServerBusySnapshot,
} from "../serverBusyState";
import { addWsTransportStateListener, type WsTransportState } from "../wsTransportEvents";
import { StatusChip } from "./ui/status-chip";

/** Shell status only: never inserts work or message rows into the transcript. */
export function ServerBusyNotice({
  snapshot,
  reconnecting = false,
}: {
  snapshot: ServerBusySnapshot;
  reconnecting?: boolean;
}) {
  if (!reconnecting && !snapshot.reason && snapshot.slowRequests === 0) return null;
  const title = reconnecting
    ? i18n._("Reconnecting to Synara server")
    : snapshot.reason === "recent-stall"
      ? i18n._("Synara server recovered")
      : i18n._("Synara server is busy");
  const pendingRequests = snapshot.pendingRequests;
  const waiting =
    pendingRequests === 1
      ? i18n._("1 request is still waiting.")
      : i18n._("{pendingRequests} requests are still waiting.", { pendingRequests });
  const seconds = ((snapshot.lastStallMs ?? 0) / 1000).toFixed(1);
  const detail = reconnecting
    ? pendingRequests
      ? i18n._(
          "The connection was interrupted. Thread updates will resume automatically when it recovers. {waiting}",
          { waiting },
        )
      : i18n._(
          "The connection was interrupted. Thread updates will resume automatically when it recovers.",
        )
    : snapshot.reason === "unresponsive"
      ? pendingRequests
        ? i18n._(
            "The server is not answering. Heavy load or a connection delay may be the cause. {waiting}",
            { waiting },
          )
        : i18n._(
            "The server is not answering. Heavy load or a connection delay may be the cause. Updates will resume when it responds.",
          )
      : snapshot.reason === "recent-stall"
        ? pendingRequests
          ? i18n._("The server paused for {seconds} s and is responding again. {waiting}", {
              seconds,
              waiting,
            })
          : i18n._("The server paused for {seconds} s and is responding again.", { seconds })
        : i18n._("{waiting} You can keep working while it completes.", { waiting });
  return (
    <div
      role="status"
      aria-live="polite"
      className="max-w-sm rounded-lg border border-border bg-popover px-3 py-2 text-ui text-popover-foreground shadow-md"
    >
      <StatusChip
        dotClassName={
          !reconnecting && snapshot.reason === "recent-stall" ? "bg-emerald-500" : "bg-amber-500"
        }
        className="font-medium"
      >
        {title}
      </StatusChip>
      <p className="mt-1 text-ui-xs leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

export function ServerBusyIndicator() {
  const [transportState, setTransportState] = useState<WsTransportState | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  useEffect(() => {
    let hasConnected = false;
    return addWsTransportStateListener(
      (state) => {
        setTransportState(state);
        if (state === "open") hasConnected = true;
        setReconnecting(hasConnected && (state === "connecting" || state === "closed"));
      },
      { replayCurrent: true },
    );
  }, []);
  const snapshot = useSyncExternalStore(
    subscribeServerBusy,
    getServerBusySnapshot,
    getServerBusySnapshot,
  );
  if (
    !reconnecting &&
    (transportState !== "open" || (!snapshot.reason && snapshot.slowRequests === 0))
  )
    return null;
  return (
    <div className="pointer-events-none fixed top-12 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2">
      <ServerBusyNotice snapshot={snapshot} reconnecting={reconnecting} />
    </div>
  );
}

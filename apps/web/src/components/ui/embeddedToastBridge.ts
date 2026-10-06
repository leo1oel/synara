import { isValidElement, type ReactNode } from "react";

export const SYNARA_EMBEDDED_NOTIFICATION = "synara:embedded-notification";
export const LATTICE_EMBEDDED_NOTIFICATION_ACTION = "lattice:embedded-notification-action";

export type EmbeddedNotificationLevel = "error" | "info" | "loading" | "success" | "warning";

export type EmbeddedNotificationAction = "dismiss" | "primary" | "secondary";

export type EmbeddedNotificationMessage =
  | {
      type: typeof SYNARA_EMBEDDED_NOTIFICATION;
      operation: "dismiss";
      id: string;
    }
  | {
      type: typeof SYNARA_EMBEDDED_NOTIFICATION;
      operation: "upsert";
      id: string;
      level: EmbeddedNotificationLevel;
      title: string;
      detail: string;
      timeoutMs: number;
      copyText?: string;
      primaryActionLabel?: string;
      secondaryActionLabel?: string;
    };

export interface EmbeddedNotificationActionMessage {
  type: typeof LATTICE_EMBEDDED_NOTIFICATION_ACTION;
  id: string;
  action: EmbeddedNotificationAction;
}

interface EmbeddableToast {
  id: string;
  type?: string | undefined;
  title?: ReactNode | undefined;
  description?: ReactNode | undefined;
  timeout?: number | undefined;
  actionProps?: { children?: ReactNode | undefined } | undefined;
  data?:
    | {
        copyText?: string | undefined;
        dismissAfterVisibleMs?: number | undefined;
        secondaryActionProps?: { children?: ReactNode | undefined } | undefined;
        archiveUndo?: unknown;
      }
    | undefined;
}

function boundedText(value: string, maximum: number): string {
  return value.trim().slice(0, maximum);
}

/** Convert the text-bearing React nodes used by Synara toasts into IPC-safe text. */
export function embeddedToastText(value: ReactNode, depth = 0): string {
  if (depth > 6 || value === null || value === undefined || typeof value === "boolean") {
    return "";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((part) => embeddedToastText(part, depth + 1)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(value)) {
    return embeddedToastText(value.props.children, depth + 1);
  }
  return "";
}

function notificationLevel(value: string | undefined): EmbeddedNotificationLevel {
  if (value === "error" || value === "loading" || value === "success" || value === "warning") {
    return value;
  }
  return "info";
}

function notificationTimeout(toast: EmbeddableToast): number {
  const requested = toast.data?.dismissAfterVisibleMs ?? toast.timeout ?? 5_000;
  if (!Number.isFinite(requested)) return 5_000;
  return Math.min(30_000, Math.max(0, Math.round(requested)));
}

export function embeddedNotificationUpsert(toast: EmbeddableToast): EmbeddedNotificationMessage {
  const title = boundedText(embeddedToastText(toast.title), 160) || "Synara notification";
  const detail = boundedText(embeddedToastText(toast.description), 4_000);
  const copyText =
    typeof toast.data?.copyText === "string" ? boundedText(toast.data.copyText, 4_000) : "";
  const archiveUndo = Boolean(toast.data?.archiveUndo);
  const primaryActionLabel = archiveUndo
    ? "Undo"
    : boundedText(embeddedToastText(toast.actionProps?.children), 48);
  const secondaryActionLabel = archiveUndo
    ? "View archived"
    : boundedText(embeddedToastText(toast.data?.secondaryActionProps?.children), 48);

  return {
    type: SYNARA_EMBEDDED_NOTIFICATION,
    operation: "upsert",
    id: boundedText(toast.id, 128),
    level: notificationLevel(toast.type),
    title,
    detail,
    timeoutMs: notificationTimeout(toast),
    ...(copyText ? { copyText } : {}),
    ...(primaryActionLabel ? { primaryActionLabel } : {}),
    ...(secondaryActionLabel ? { secondaryActionLabel } : {}),
  };
}

export function embeddedNotificationDismiss(id: string): EmbeddedNotificationMessage {
  return {
    type: SYNARA_EMBEDDED_NOTIFICATION,
    operation: "dismiss",
    id: boundedText(id, 128),
  };
}

export function isEmbeddedNotificationActionMessage(
  value: unknown,
): value is EmbeddedNotificationActionMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EmbeddedNotificationActionMessage>;
  return (
    candidate.type === LATTICE_EMBEDDED_NOTIFICATION_ACTION &&
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    candidate.id.length <= 128 &&
    (candidate.action === "dismiss" ||
      candidate.action === "primary" ||
      candidate.action === "secondary")
  );
}

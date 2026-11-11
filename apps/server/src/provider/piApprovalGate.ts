/**
 * Synara approval gate for Pi sessions that are not in full-access mode.
 *
 * Pi has no approval protocol of its own: its built-in tools run as soon as
 * the model calls them. The SDK does fire a `tool_call` extension hook before
 * each tool runs, and a handler can block the call. This module registers one
 * inline extension that, for the tools that change the workspace (edit, write
 * and shell commands), raises a Synara approval request and waits for the
 * writer's decision. Approval runs the tool unchanged; anything else blocks it
 * with a reason the model sees as the tool's error.
 *
 * Full-access sessions never install the gate, so they run exactly as before.
 * A session's runtime mode is fixed for its lifetime: changing it restarts the
 * Pi session (ProviderCommandReactor), so the gate never needs to re-check it.
 */
import crypto from "node:crypto";

import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  ApprovalRequestId,
  type CanonicalRequestType,
  type ProviderApprovalDecision,
} from "@synara/contracts";

const GATED_TOOL_REQUEST_TYPES: Readonly<Record<string, CanonicalRequestType>> = {
  bash: "command_execution_approval",
  powershell: "command_execution_approval",
  edit: "file_change_approval",
  write: "file_change_approval",
};

export interface PiApprovalRequestOpened {
  readonly requestId: ApprovalRequestId;
  readonly requestType: CanonicalRequestType;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly detail: string | undefined;
  readonly input: unknown;
}

export interface PiApprovalRequestResolved {
  readonly requestId: ApprovalRequestId;
  readonly requestType: CanonicalRequestType;
  readonly toolCallId: string;
  readonly decision: ProviderApprovalDecision;
}

/** Where the gate reports requests; bound once the adapter's session context exists. */
export interface PiApprovalGateSink {
  readonly opened: (request: PiApprovalRequestOpened) => void;
  readonly resolved: (request: PiApprovalRequestResolved) => void;
}

export interface PiApprovalGate {
  /** The inline extension to hand to Pi's resource loader. */
  readonly extension: InlineExtension;
  readonly bind: (sink: PiApprovalGateSink) => void;
  /** Settles a pending request; false when no such request is pending. */
  readonly respond: (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => boolean;
  /** Cancels every pending request, for example when the session stops. */
  readonly cancelAll: () => void;
}

function stringField(input: unknown, key: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function approvalDetail(toolName: string, input: unknown): string | undefined {
  return GATED_TOOL_REQUEST_TYPES[toolName] === "command_execution_approval"
    ? stringField(input, "command")
    : stringField(input, "path");
}

function declinedReason(toolName: string, decision: ProviderApprovalDecision): string {
  return decision === "cancel"
    ? `The ${toolName} call was cancelled before the user approved it. Do not retry it unless the user asks.`
    : `The user declined this ${toolName} call. Do not retry it; ask the user how to proceed instead.`;
}

export function makePiApprovalGate(): PiApprovalGate {
  let sink: PiApprovalGateSink | undefined;
  const pending = new Map<ApprovalRequestId, (decision: ProviderApprovalDecision) => void>();
  // "Allow for session" covers the same command or the same file again, not
  // every later call of that tool.
  const approvedForSession = new Set<string>();

  const requestDecision = (
    request: Omit<PiApprovalRequestOpened, "requestId">,
    signal: AbortSignal | undefined,
  ): Promise<ProviderApprovalDecision> => {
    const target = sink;
    if (!target || signal?.aborted) return Promise.resolve("cancel");
    const requestId = ApprovalRequestId.makeUnsafe(crypto.randomUUID());
    return new Promise((resolve) => {
      const abort = () => settle("cancel");
      const settle = (decision: ProviderApprovalDecision) => {
        if (!pending.delete(requestId)) return;
        signal?.removeEventListener("abort", abort);
        target.resolved({
          requestId,
          requestType: request.requestType,
          toolCallId: request.toolCallId,
          decision,
        });
        resolve(decision);
      };
      pending.set(requestId, settle);
      signal?.addEventListener("abort", abort, { once: true });
      target.opened({ ...request, requestId });
    });
  };

  const extension: InlineExtension = {
    name: "synara-approval-gate",
    factory: (pi) => {
      pi.on("tool_call", async (event, ctx) => {
        const requestType = GATED_TOOL_REQUEST_TYPES[event.toolName];
        if (!requestType) return undefined;
        const detail = approvalDetail(event.toolName, event.input);
        const sessionKey = `${event.toolName}\u0000${detail ?? JSON.stringify(event.input)}`;
        if (approvedForSession.has(sessionKey)) return undefined;
        const decision = await requestDecision(
          {
            requestType,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            detail,
            input: event.input,
          },
          ctx.signal,
        );
        if (decision === "acceptForSession") {
          approvedForSession.add(sessionKey);
          return undefined;
        }
        if (decision === "accept") return undefined;
        return { block: true, reason: declinedReason(event.toolName, decision) };
      });
    },
  };

  return {
    extension,
    bind: (next) => {
      sink = next;
    },
    respond: (requestId, decision) => {
      const settle = pending.get(requestId);
      if (!settle) return false;
      settle(decision);
      return true;
    },
    cancelAll: () => {
      for (const settle of Array.from(pending.values())) settle("cancel");
    },
  };
}

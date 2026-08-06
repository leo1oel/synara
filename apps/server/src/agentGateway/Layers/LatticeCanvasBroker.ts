import { randomUUID } from "node:crypto";

import { Effect, Layer } from "effect";

import {
  LatticeCanvasBroker,
  LatticeCanvasBrokerError,
  type LatticeCanvasBrokerShape,
  type LatticeCanvasRequest,
  type LatticeCanvasResult,
} from "../Services/LatticeCanvasBroker.ts";

export const LATTICE_CANVAS_TOOL_TIMEOUT_MS = 30_000;
export const LATTICE_CANVAS_POLL_TIMEOUT_MS = 25_000;

export function makeLatticeCanvasBroker(options?: {
  readonly randomId?: () => string;
  readonly toolTimeoutMs?: number;
  readonly pollTimeoutMs?: number;
}): LatticeCanvasBrokerShape {
  const queues = new Map<string, LatticeCanvasRequest[]>();
  const pollers = new Map<string, Array<(request: LatticeCanvasRequest | null) => void>>();
  const pending = new Map<
    string,
    {
      readonly workspaceRoot: string;
      readonly resolve: (value: unknown) => void;
      readonly reject: (error: LatticeCanvasBrokerError) => void;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  >();
  const randomId = options?.randomId ?? randomUUID;
  const toolTimeoutMs = options?.toolTimeoutMs ?? LATTICE_CANVAS_TOOL_TIMEOUT_MS;
  const pollTimeoutMs = options?.pollTimeoutMs ?? LATTICE_CANVAS_POLL_TIMEOUT_MS;

  return {
    invoke: (workspaceRoot, action, args) =>
      Effect.callback<unknown, LatticeCanvasBrokerError>((resume) => {
        const id = randomId();
        const request = {
          id,
          action,
          args,
          expiresAt: Date.now() + toolTimeoutMs,
        } satisfies LatticeCanvasRequest;
        const removeQueued = () => {
          const queue = queues.get(workspaceRoot) ?? [];
          const queuedIndex = queue.findIndex((queued) => queued.id === id);
          if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
        };
        const timer = setTimeout(() => {
          pending.delete(id);
          removeQueued();
          resume(
            Effect.fail(
              new LatticeCanvasBrokerError("canvas_tool_timeout", "The canvas tool timed out after 30 seconds."),
            ),
          );
        }, toolTimeoutMs);
        pending.set(id, {
          workspaceRoot,
          resolve: (value) => resume(Effect.succeed(value)),
          reject: (error) => resume(Effect.fail(error)),
          timer,
        });
        const workspacePollers = pollers.get(workspaceRoot) ?? [];
        const poller = workspacePollers.shift();
        if (poller) poller(request);
        else {
          const queue = queues.get(workspaceRoot) ?? [];
          queue.push(request);
          queues.set(workspaceRoot, queue);
        }
        return Effect.sync(() => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          removeQueued();
        });
      }),
    poll: (workspaceRoot) =>
      Effect.callback<LatticeCanvasRequest | null>((resume) => {
        const queue = queues.get(workspaceRoot) ?? [];
        const request = queue.shift();
        if (request) {
          resume(Effect.succeed(request));
          return;
        }
        let settled = false;
        const finish = (value: LatticeCanvasRequest | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const workspacePollers = pollers.get(workspaceRoot) ?? [];
          const index = workspacePollers.indexOf(finish);
          if (index >= 0) workspacePollers.splice(index, 1);
          resume(Effect.succeed(value));
        };
        const timer = setTimeout(() => finish(null), pollTimeoutMs);
        const workspacePollers = pollers.get(workspaceRoot) ?? [];
        workspacePollers.push(finish);
        pollers.set(workspaceRoot, workspacePollers);
        return Effect.sync(() => finish(null));
      }),
    complete: (workspaceRoot, id, result: LatticeCanvasResult) =>
      Effect.sync(() => {
        const entry = pending.get(id);
        if (!entry || entry.workspaceRoot !== workspaceRoot) return false;
        pending.delete(id);
        clearTimeout(entry.timer);
        if (result.ok) entry.resolve(result.result);
        else {
          entry.reject(
            new LatticeCanvasBrokerError(
              result.error?.code ?? "canvas_tool_failed",
              result.error?.message ?? "The canvas host rejected the request.",
            ),
          );
        }
        return true;
      }),
  };
}

export const LatticeCanvasBrokerLive = Layer.sync(LatticeCanvasBroker, makeLatticeCanvasBroker);

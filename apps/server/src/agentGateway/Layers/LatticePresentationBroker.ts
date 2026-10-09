import { randomUUID } from "node:crypto";

import { Effect, Layer } from "effect";

import {
  LatticePresentationBroker,
  LatticePresentationBrokerError,
  type LatticePresentationBrokerShape,
  type LatticePresentationRequest,
  type LatticePresentationResult,
} from "../Services/LatticePresentationBroker.ts";

// Lattice may first have to start its presentation runtime (up to 30 seconds)
// before the preview page settles (up to 20 seconds) and is rasterized.
export const LATTICE_PRESENTATION_TOOL_TIMEOUT_MS = 75_000;
export const LATTICE_PRESENTATION_POLL_TIMEOUT_MS = 25_000;

export function makeLatticePresentationBroker(options?: {
  readonly randomId?: () => string;
  readonly toolTimeoutMs?: number;
  readonly pollTimeoutMs?: number;
}): LatticePresentationBrokerShape {
  const queues = new Map<string, LatticePresentationRequest[]>();
  const pollers = new Map<string, Array<(request: LatticePresentationRequest | null) => void>>();
  const pending = new Map<
    string,
    {
      readonly workspaceRoot: string;
      readonly resolve: (value: unknown) => void;
      readonly reject: (error: LatticePresentationBrokerError) => void;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  >();
  const randomId = options?.randomId ?? randomUUID;
  const toolTimeoutMs = options?.toolTimeoutMs ?? LATTICE_PRESENTATION_TOOL_TIMEOUT_MS;
  const pollTimeoutMs = options?.pollTimeoutMs ?? LATTICE_PRESENTATION_POLL_TIMEOUT_MS;

  return {
    invoke: (workspaceRoot, action, args) =>
      Effect.callback<unknown, LatticePresentationBrokerError>((resume) => {
        const id = randomId();
        const request = {
          id,
          action,
          args,
          expiresAt: Date.now() + toolTimeoutMs,
        } satisfies LatticePresentationRequest;
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
              new LatticePresentationBrokerError(
                "presentation_tool_timeout",
                "The presentation tool timed out after 75 seconds.",
              ),
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
      Effect.callback<LatticePresentationRequest | null>((resume) => {
        const queue = queues.get(workspaceRoot) ?? [];
        const request = queue.shift();
        if (request) {
          resume(Effect.succeed(request));
          return;
        }
        let settled = false;
        const finish = (value: LatticePresentationRequest | null) => {
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
    complete: (workspaceRoot, id, result: LatticePresentationResult) =>
      Effect.sync(() => {
        const entry = pending.get(id);
        if (!entry || entry.workspaceRoot !== workspaceRoot) return false;
        pending.delete(id);
        clearTimeout(entry.timer);
        if (result.ok) entry.resolve(result.result);
        else {
          entry.reject(
            new LatticePresentationBrokerError(
              result.error?.code ?? "presentation_tool_failed",
              result.error?.message ?? "The presentation host rejected the request.",
            ),
          );
        }
        return true;
      }),
  };
}

export const LatticePresentationBrokerLive = Layer.sync(
  LatticePresentationBroker,
  makeLatticePresentationBroker,
);

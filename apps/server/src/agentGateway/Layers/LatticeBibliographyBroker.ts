import { randomUUID } from "node:crypto";

import { Effect, Layer } from "effect";

import {
  LatticeBibliographyBroker,
  LatticeBibliographyBrokerError,
  type LatticeBibliographyBrokerShape,
  type LatticeBibliographyRequest,
  type LatticeBibliographyResult,
} from "../Services/LatticeBibliographyBroker.ts";

export const LATTICE_BIBLIOGRAPHY_TOOL_TIMEOUT_MS = 30_000;
export const LATTICE_BIBLIOGRAPHY_POLL_TIMEOUT_MS = 25_000;

export function makeLatticeBibliographyBroker(options?: {
  readonly randomId?: () => string;
  readonly toolTimeoutMs?: number;
  readonly pollTimeoutMs?: number;
}): LatticeBibliographyBrokerShape {
  const queues = new Map<string, LatticeBibliographyRequest[]>();
  const pollers = new Map<string, Array<(request: LatticeBibliographyRequest | null) => void>>();
  const pending = new Map<
    string,
    {
      readonly workspaceRoot: string;
      readonly resolve: (value: Record<string, unknown>) => void;
      readonly reject: (error: LatticeBibliographyBrokerError) => void;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  >();
  const randomId = options?.randomId ?? randomUUID;
  const toolTimeoutMs = options?.toolTimeoutMs ?? LATTICE_BIBLIOGRAPHY_TOOL_TIMEOUT_MS;
  const pollTimeoutMs = options?.pollTimeoutMs ?? LATTICE_BIBLIOGRAPHY_POLL_TIMEOUT_MS;

  return {
    invoke: (workspaceRoot, action, params) =>
      Effect.callback<Record<string, unknown>, LatticeBibliographyBrokerError>((resume) => {
        const id = randomId();
        const request = {
          id,
          action,
          params,
          expiresAt: Date.now() + toolTimeoutMs,
        } satisfies LatticeBibliographyRequest;
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
              new LatticeBibliographyBrokerError(
                "bibliography_tool_timeout",
                "The bibliography tool timed out after 30 seconds.",
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
      Effect.callback<LatticeBibliographyRequest | null>((resume) => {
        const queue = queues.get(workspaceRoot) ?? [];
        const request = queue.shift();
        if (request) {
          resume(Effect.succeed(request));
          return;
        }
        let settled = false;
        const finish = (value: LatticeBibliographyRequest | null) => {
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
    complete: (workspaceRoot, id, result: LatticeBibliographyResult) =>
      Effect.sync(() => {
        const entry = pending.get(id);
        if (!entry || entry.workspaceRoot !== workspaceRoot) return false;
        pending.delete(id);
        clearTimeout(entry.timer);
        if (result.ok && result.result) entry.resolve(result.result);
        else {
          entry.reject(
            new LatticeBibliographyBrokerError(
              result.error?.code ?? "bibliography_tool_failed",
              result.error?.message ?? "The Lattice host rejected the bibliography request.",
            ),
          );
        }
        return true;
      }),
  };
}

export const LatticeBibliographyBrokerLive = Layer.sync(
  LatticeBibliographyBroker,
  makeLatticeBibliographyBroker,
);

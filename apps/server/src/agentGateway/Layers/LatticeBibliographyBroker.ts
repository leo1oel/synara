import { randomUUID } from "node:crypto";

import { Effect, Layer } from "effect";

import {
  LatticeBibliographyBroker,
  LatticeBibliographyBrokerError,
  type LatticeBibliographyBrokerShape,
  type LatticeBibliographyRequest,
  type LatticeBibliographyResult,
} from "../Services/LatticeBibliographyBroker.ts";
import {
  LatticeHostToolQueue,
  type LatticeHostToolQueueShape,
} from "../Services/LatticeHostToolQueue.ts";
import { LatticeHostToolQueueLive } from "./LatticeHostToolQueue.ts";

export const LATTICE_BIBLIOGRAPHY_TOOL_TIMEOUT_MS = 30_000;

export function makeLatticeBibliographyBroker(
  hostTools: LatticeHostToolQueueShape,
  options?: {
    readonly randomId?: () => string;
    readonly toolTimeoutMs?: number;
  },
): LatticeBibliographyBrokerShape {
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
        const timer = setTimeout(() => {
          pending.delete(id);
          hostTools.withdraw(workspaceRoot, id);
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
        hostTools.offer(workspaceRoot, "bibliography", request);
        return Effect.sync(() => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          hostTools.withdraw(workspaceRoot, id);
        });
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

export const LatticeBibliographyBrokerLive = Layer.effect(
  LatticeBibliographyBroker,
  Effect.gen(function* () {
    return makeLatticeBibliographyBroker(yield* LatticeHostToolQueue);
  }),
).pipe(Layer.provide(LatticeHostToolQueueLive));

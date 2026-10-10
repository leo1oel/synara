import { randomUUID } from "node:crypto";

import { Effect, Layer } from "effect";

import {
  LatticePresentationBroker,
  LatticePresentationBrokerError,
  type LatticePresentationBrokerShape,
  type LatticePresentationRequest,
  type LatticePresentationResult,
} from "../Services/LatticePresentationBroker.ts";
import {
  LatticeHostToolQueue,
  type LatticeHostToolQueueShape,
} from "../Services/LatticeHostToolQueue.ts";
import { LatticeHostToolQueueLive } from "./LatticeHostToolQueue.ts";

// Lattice may first have to start its presentation runtime (up to 30 seconds)
// before the preview page settles (up to 20 seconds) and is rasterized.
export const LATTICE_PRESENTATION_TOOL_TIMEOUT_MS = 75_000;

export function makeLatticePresentationBroker(
  hostTools: LatticeHostToolQueueShape,
  options?: {
    readonly randomId?: () => string;
    readonly toolTimeoutMs?: number;
  },
): LatticePresentationBrokerShape {
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
        const timer = setTimeout(() => {
          pending.delete(id);
          hostTools.withdraw(workspaceRoot, id);
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
        hostTools.offer(workspaceRoot, "presentation", request);
        return Effect.sync(() => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          hostTools.withdraw(workspaceRoot, id);
        });
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

export const LatticePresentationBrokerLive = Layer.effect(
  LatticePresentationBroker,
  Effect.gen(function* () {
    return makeLatticePresentationBroker(yield* LatticeHostToolQueue);
  }),
).pipe(Layer.provide(LatticeHostToolQueueLive));

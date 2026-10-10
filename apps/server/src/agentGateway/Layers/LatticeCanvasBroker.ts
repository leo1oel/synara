import { randomUUID } from "node:crypto";

import { Effect, Layer } from "effect";

import {
  LatticeCanvasBroker,
  LatticeCanvasBrokerError,
  type LatticeCanvasBrokerShape,
  type LatticeCanvasRequest,
  type LatticeCanvasResult,
} from "../Services/LatticeCanvasBroker.ts";
import {
  LatticeHostToolQueue,
  type LatticeHostToolQueueShape,
} from "../Services/LatticeHostToolQueue.ts";
import { LatticeHostToolQueueLive } from "./LatticeHostToolQueue.ts";

export const LATTICE_CANVAS_TOOL_TIMEOUT_MS = 30_000;

export function makeLatticeCanvasBroker(
  hostTools: LatticeHostToolQueueShape,
  options?: {
    readonly randomId?: () => string;
    readonly toolTimeoutMs?: number;
  },
): LatticeCanvasBrokerShape {
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
        const timer = setTimeout(() => {
          pending.delete(id);
          hostTools.withdraw(workspaceRoot, id);
          resume(
            Effect.fail(
              new LatticeCanvasBrokerError(
                "canvas_tool_timeout",
                "The canvas tool timed out after 30 seconds.",
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
        hostTools.offer(workspaceRoot, "canvas", request);
        return Effect.sync(() => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          hostTools.withdraw(workspaceRoot, id);
        });
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

export const LatticeCanvasBrokerLive = Layer.effect(
  LatticeCanvasBroker,
  Effect.gen(function* () {
    return makeLatticeCanvasBroker(yield* LatticeHostToolQueue);
  }),
).pipe(Layer.provide(LatticeHostToolQueueLive));

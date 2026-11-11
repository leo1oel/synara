import { randomUUID } from "node:crypto";

import { Effect, Layer } from "effect";

import {
  LatticeProjectDocumentBroker,
  LatticeProjectDocumentBrokerError,
  type LatticeProjectDocumentBrokerShape,
  type LatticeProjectDocumentRequest,
  type LatticeProjectDocumentResult,
} from "../Services/LatticeProjectDocumentBroker.ts";
import {
  LatticeHostToolQueue,
  type LatticeHostToolQueueShape,
} from "../Services/LatticeHostToolQueue.ts";
import { LatticeHostToolQueueLive } from "./LatticeHostToolQueue.ts";

export const LATTICE_PROJECT_DOCUMENT_TOOL_TIMEOUT_MS = 30_000;

export function makeLatticeProjectDocumentBroker(
  hostTools: LatticeHostToolQueueShape,
  options?: {
    readonly randomId?: () => string;
    readonly toolTimeoutMs?: number;
  },
): LatticeProjectDocumentBrokerShape {
  const pending = new Map<
    string,
    {
      readonly workspaceRoot: string;
      readonly resolve: (value: unknown) => void;
      readonly reject: (error: LatticeProjectDocumentBrokerError) => void;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  >();
  const randomId = options?.randomId ?? randomUUID;
  const toolTimeoutMs = options?.toolTimeoutMs ?? LATTICE_PROJECT_DOCUMENT_TOOL_TIMEOUT_MS;

  return {
    invoke: (workspaceRoot, args) =>
      Effect.callback<unknown, LatticeProjectDocumentBrokerError>((resume) => {
        const id = randomId();
        const request = {
          id,
          args,
          expiresAt: Date.now() + toolTimeoutMs,
        } satisfies LatticeProjectDocumentRequest;
        const timer = setTimeout(() => {
          pending.delete(id);
          hostTools.withdraw(workspaceRoot, id);
          resume(
            Effect.fail(
              new LatticeProjectDocumentBrokerError(
                "project_document_tool_timeout",
                "The project document tool timed out after 30 seconds.",
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
        hostTools.offer(workspaceRoot, "projectDocument", request);
        return Effect.sync(() => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          hostTools.withdraw(workspaceRoot, id);
        });
      }),
    complete: (workspaceRoot, id, result: LatticeProjectDocumentResult) =>
      Effect.sync(() => {
        const entry = pending.get(id);
        if (!entry || entry.workspaceRoot !== workspaceRoot) return false;
        pending.delete(id);
        clearTimeout(entry.timer);
        if (result.ok) entry.resolve(result.result);
        else {
          entry.reject(
            new LatticeProjectDocumentBrokerError(
              result.error?.code ?? "project_document_create_failed",
              result.error?.message ?? "The Lattice host rejected the document creation request.",
            ),
          );
        }
        return true;
      }),
  };
}

export const LatticeProjectDocumentBrokerLive = Layer.effect(
  LatticeProjectDocumentBroker,
  Effect.gen(function* () {
    return makeLatticeProjectDocumentBroker(yield* LatticeHostToolQueue);
  }),
).pipe(Layer.provide(LatticeHostToolQueueLive));

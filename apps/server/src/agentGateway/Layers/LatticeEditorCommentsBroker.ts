import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import {
  LatticeEditorCommentsBroker,
  LatticeEditorCommentsBrokerError,
  type LatticeEditorCommentsBrokerShape,
  type LatticeEditorCommentsResult,
} from "../Services/LatticeEditorCommentsBroker.ts";
import {
  LatticeHostToolQueue,
  type LatticeHostToolQueueShape,
} from "../Services/LatticeHostToolQueue.ts";
import { LatticeHostToolQueueLive } from "./LatticeHostToolQueue.ts";

export function makeLatticeEditorCommentsBroker(
  hostTools: LatticeHostToolQueueShape,
  options?: {
    randomId?: () => string;
    toolTimeoutMs?: number;
  },
): LatticeEditorCommentsBrokerShape {
  const pending = new Map<
    string,
    {
      workspaceRoot: string;
      resolve: (value: unknown) => void;
      reject: (error: LatticeEditorCommentsBrokerError) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const toolTimeoutMs = options?.toolTimeoutMs ?? 30_000;
  return {
    invoke: (workspaceRoot, args) =>
      Effect.callback((resume) => {
        const id = (options?.randomId ?? randomUUID)();
        const request = { id, workspaceRoot, args, expiresAt: Date.now() + toolTimeoutMs };
        const timer = setTimeout(() => {
          pending.delete(id);
          hostTools.withdraw(workspaceRoot, id);
          resume(
            Effect.fail(
              new LatticeEditorCommentsBrokerError(
                "editor_comments_tool_timeout",
                "The editor comments tool timed out.",
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
        hostTools.offer(workspaceRoot, "editorComments", request);
        return Effect.sync(() => {
          if (pending.delete(id)) {
            clearTimeout(timer);
            hostTools.withdraw(workspaceRoot, id);
          }
        });
      }),
    complete: (workspaceRoot, id, result: LatticeEditorCommentsResult) =>
      Effect.sync(() => {
        const entry = pending.get(id);
        if (!entry || entry.workspaceRoot !== workspaceRoot) return false;
        pending.delete(id);
        clearTimeout(entry.timer);
        if (result.ok) entry.resolve(result.result);
        else
          entry.reject(
            new LatticeEditorCommentsBrokerError(
              result.error?.code ?? "editor_comments_failed",
              result.error?.message ?? "The Lattice host rejected the editor comments request.",
            ),
          );
        return true;
      }),
  };
}
export const LatticeEditorCommentsBrokerLive = Layer.effect(
  LatticeEditorCommentsBroker,
  Effect.gen(function* () {
    return makeLatticeEditorCommentsBroker(yield* LatticeHostToolQueue);
  }),
).pipe(Layer.provide(LatticeHostToolQueueLive));

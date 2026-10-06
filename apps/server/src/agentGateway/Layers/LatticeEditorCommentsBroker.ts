import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import {
  LatticeEditorCommentsBroker,
  LatticeEditorCommentsBrokerError,
  type LatticeEditorCommentsBrokerShape,
  type LatticeEditorCommentsRequest,
  type LatticeEditorCommentsResult,
} from "../Services/LatticeEditorCommentsBroker.ts";

export function makeLatticeEditorCommentsBroker(options?: {
  randomId?: () => string;
  toolTimeoutMs?: number;
  pollTimeoutMs?: number;
}): LatticeEditorCommentsBrokerShape {
  const queues = new Map<string, LatticeEditorCommentsRequest[]>();
  const pollers = new Map<string, Array<(value: LatticeEditorCommentsRequest | null) => void>>();
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
  const pollTimeoutMs = options?.pollTimeoutMs ?? 25_000;
  return {
    invoke: (workspaceRoot, args) =>
      Effect.callback((resume) => {
        const id = (options?.randomId ?? randomUUID)();
        const request = { id, workspaceRoot, args, expiresAt: Date.now() + toolTimeoutMs };
        const removeQueued = () => {
          const queue = queues.get(workspaceRoot) ?? [];
          const index = queue.findIndex((item) => item.id === id);
          if (index >= 0) queue.splice(index, 1);
        };
        const timer = setTimeout(() => {
          pending.delete(id);
          removeQueued();
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
        const poller = (pollers.get(workspaceRoot) ?? []).shift();
        if (poller) poller(request);
        else {
          const queue = queues.get(workspaceRoot) ?? [];
          queue.push(request);
          queues.set(workspaceRoot, queue);
        }
        return Effect.sync(() => {
          if (pending.delete(id)) {
            clearTimeout(timer);
            removeQueued();
          }
        });
      }),
    poll: (workspaceRoot) =>
      Effect.callback((resume) => {
        const request = (queues.get(workspaceRoot) ?? []).shift();
        if (request) {
          resume(Effect.succeed(request));
          return;
        }
        let settled = false;
        const finish = (value: LatticeEditorCommentsRequest | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const list = pollers.get(workspaceRoot) ?? [];
          const index = list.indexOf(finish);
          if (index >= 0) list.splice(index, 1);
          resume(Effect.succeed(value));
        };
        const timer = setTimeout(() => finish(null), pollTimeoutMs);
        const list = pollers.get(workspaceRoot) ?? [];
        list.push(finish);
        pollers.set(workspaceRoot, list);
        return Effect.sync(() => finish(null));
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
export const LatticeEditorCommentsBrokerLive = Layer.sync(
  LatticeEditorCommentsBroker,
  makeLatticeEditorCommentsBroker,
);

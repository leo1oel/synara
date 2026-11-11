import { randomUUID } from "node:crypto";

import { Effect, Layer } from "effect";

import {
  LatticeSpreadsheetBroker,
  LatticeSpreadsheetBrokerError,
  type LatticeSpreadsheetBrokerShape,
  type LatticeSpreadsheetRequest,
  type LatticeSpreadsheetResult,
} from "../Services/LatticeSpreadsheetBroker.ts";
import {
  LatticeHostToolQueue,
  type LatticeHostToolQueueShape,
} from "../Services/LatticeHostToolQueue.ts";
import { LatticeHostToolQueueLive } from "./LatticeHostToolQueue.ts";

export const LATTICE_SPREADSHEET_TOOL_TIMEOUT_MS = 30_000;

export function makeLatticeSpreadsheetBroker(
  hostTools: LatticeHostToolQueueShape,
  options?: {
    readonly randomId?: () => string;
    readonly toolTimeoutMs?: number;
  },
): LatticeSpreadsheetBrokerShape {
  const pending = new Map<
    string,
    {
      readonly workspaceRoot: string;
      readonly resolve: (value: unknown) => void;
      readonly reject: (error: LatticeSpreadsheetBrokerError) => void;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  >();
  const randomId = options?.randomId ?? randomUUID;
  const toolTimeoutMs = options?.toolTimeoutMs ?? LATTICE_SPREADSHEET_TOOL_TIMEOUT_MS;

  return {
    invoke: (workspaceRoot, action, args) =>
      Effect.callback<unknown, LatticeSpreadsheetBrokerError>((resume) => {
        const id = randomId();
        const request = {
          id,
          action,
          args,
          expiresAt: Date.now() + toolTimeoutMs,
        } satisfies LatticeSpreadsheetRequest;
        const timer = setTimeout(() => {
          pending.delete(id);
          hostTools.withdraw(workspaceRoot, id);
          resume(
            Effect.fail(
              new LatticeSpreadsheetBrokerError(
                "spreadsheet_tool_timeout",
                "The spreadsheet tool timed out after 30 seconds.",
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
        hostTools.offer(workspaceRoot, "spreadsheet", request);
        return Effect.sync(() => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          hostTools.withdraw(workspaceRoot, id);
        });
      }),
    complete: (workspaceRoot, id, result: LatticeSpreadsheetResult) =>
      Effect.sync(() => {
        const entry = pending.get(id);
        if (!entry || entry.workspaceRoot !== workspaceRoot) return false;
        pending.delete(id);
        clearTimeout(entry.timer);
        if (result.ok) entry.resolve(result.result);
        else {
          entry.reject(
            new LatticeSpreadsheetBrokerError(
              result.error?.code ?? "spreadsheet_tool_failed",
              result.error?.message ?? "The spreadsheet host rejected the request.",
            ),
          );
        }
        return true;
      }),
  };
}

export const LatticeSpreadsheetBrokerLive = Layer.effect(
  LatticeSpreadsheetBroker,
  Effect.gen(function* () {
    return makeLatticeSpreadsheetBroker(yield* LatticeHostToolQueue);
  }),
).pipe(Layer.provide(LatticeHostToolQueueLive));

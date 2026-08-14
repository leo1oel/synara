import { ServiceMap } from "effect";
import type { Effect } from "effect";

export type LatticeSpreadsheetAction = "read" | "batch_update";

export interface LatticeSpreadsheetRequest {
  readonly id: string;
  readonly action: LatticeSpreadsheetAction;
  readonly args: Record<string, unknown>;
  readonly expiresAt: number;
}

export interface LatticeSpreadsheetResult {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

export class LatticeSpreadsheetBrokerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface LatticeSpreadsheetBrokerShape {
  readonly invoke: (
    workspaceRoot: string,
    action: LatticeSpreadsheetAction,
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, LatticeSpreadsheetBrokerError>;
  readonly poll: (workspaceRoot: string) => Effect.Effect<LatticeSpreadsheetRequest | null>;
  readonly complete: (
    workspaceRoot: string,
    id: string,
    result: LatticeSpreadsheetResult,
  ) => Effect.Effect<boolean>;
}

export class LatticeSpreadsheetBroker extends ServiceMap.Service<
  LatticeSpreadsheetBroker,
  LatticeSpreadsheetBrokerShape
>()("synara/agentGateway/Services/LatticeSpreadsheetBroker") {}

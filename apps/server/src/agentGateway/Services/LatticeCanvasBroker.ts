import { ServiceMap } from "effect";
import type { Effect } from "effect";

export type LatticeCanvasAction = "list" | "create" | "update" | "delete";

export interface LatticeCanvasRequest {
  readonly id: string;
  readonly action: LatticeCanvasAction;
  readonly args: Record<string, unknown>;
  readonly expiresAt: number;
}

export interface LatticeCanvasResult {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

export class LatticeCanvasBrokerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface LatticeCanvasBrokerShape {
  readonly invoke: (
    workspaceRoot: string,
    action: LatticeCanvasAction,
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, LatticeCanvasBrokerError>;
  readonly poll: (workspaceRoot: string) => Effect.Effect<LatticeCanvasRequest | null>;
  readonly complete: (
    workspaceRoot: string,
    id: string,
    result: LatticeCanvasResult,
  ) => Effect.Effect<boolean>;
}

export class LatticeCanvasBroker extends ServiceMap.Service<
  LatticeCanvasBroker,
  LatticeCanvasBrokerShape
>()("synara/agentGateway/Services/LatticeCanvasBroker") {}

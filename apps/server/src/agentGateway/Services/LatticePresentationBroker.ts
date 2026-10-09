import { ServiceMap } from "effect";
import type { Effect } from "effect";

export type LatticePresentationAction = "preview_page";

export interface LatticePresentationRequest {
  readonly id: string;
  readonly action: LatticePresentationAction;
  readonly args: Record<string, unknown>;
  readonly expiresAt: number;
}

export interface LatticePresentationResult {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

export class LatticePresentationBrokerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface LatticePresentationBrokerShape {
  readonly invoke: (
    workspaceRoot: string,
    action: LatticePresentationAction,
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, LatticePresentationBrokerError>;
  readonly poll: (workspaceRoot: string) => Effect.Effect<LatticePresentationRequest | null>;
  readonly complete: (
    workspaceRoot: string,
    id: string,
    result: LatticePresentationResult,
  ) => Effect.Effect<boolean>;
}

export class LatticePresentationBroker extends ServiceMap.Service<
  LatticePresentationBroker,
  LatticePresentationBrokerShape
>()("synara/agentGateway/Services/LatticePresentationBroker") {}

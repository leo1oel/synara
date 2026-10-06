import { ServiceMap } from "effect";
import type { Effect } from "effect";

export type LatticeBibliographyAction = "cite" | "upgrade_bibliography" | "remove_reference";

export interface LatticeBibliographyRequest {
  readonly id: string;
  readonly action: LatticeBibliographyAction;
  readonly params: Record<string, unknown>;
  readonly expiresAt: number;
}

export interface LatticeBibliographyResult {
  readonly ok: boolean;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: string; readonly message: string };
}

export class LatticeBibliographyBrokerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface LatticeBibliographyBrokerShape {
  readonly invoke: (
    workspaceRoot: string,
    action: LatticeBibliographyAction,
    params: Record<string, unknown>,
  ) => Effect.Effect<Record<string, unknown>, LatticeBibliographyBrokerError>;
  readonly poll: (workspaceRoot: string) => Effect.Effect<LatticeBibliographyRequest | null>;
  readonly complete: (
    workspaceRoot: string,
    id: string,
    result: LatticeBibliographyResult,
  ) => Effect.Effect<boolean>;
}

export class LatticeBibliographyBroker extends ServiceMap.Service<
  LatticeBibliographyBroker,
  LatticeBibliographyBrokerShape
>()("synara/agentGateway/Services/LatticeBibliographyBroker") {}

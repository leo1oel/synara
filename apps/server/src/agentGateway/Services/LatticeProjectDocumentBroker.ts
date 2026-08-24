import { ServiceMap } from "effect";
import type { Effect } from "effect";

export type LatticeProjectDocumentType = "board" | "spreadsheet";

export interface LatticeProjectDocumentRequest {
  readonly id: string;
  readonly args: {
    readonly path: string;
    readonly documentType: LatticeProjectDocumentType;
  };
  readonly expiresAt: number;
}

export interface LatticeProjectDocumentResult {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

export class LatticeProjectDocumentBrokerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface LatticeProjectDocumentBrokerShape {
  readonly invoke: (
    workspaceRoot: string,
    args: LatticeProjectDocumentRequest["args"],
  ) => Effect.Effect<unknown, LatticeProjectDocumentBrokerError>;
  readonly poll: (workspaceRoot: string) => Effect.Effect<LatticeProjectDocumentRequest | null>;
  readonly complete: (
    workspaceRoot: string,
    id: string,
    result: LatticeProjectDocumentResult,
  ) => Effect.Effect<boolean>;
}

export class LatticeProjectDocumentBroker extends ServiceMap.Service<
  LatticeProjectDocumentBroker,
  LatticeProjectDocumentBrokerShape
>()("synara/agentGateway/Services/LatticeProjectDocumentBroker") {}

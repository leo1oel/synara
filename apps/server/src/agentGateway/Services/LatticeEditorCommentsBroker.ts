import { ServiceMap, type Effect } from "effect";

export interface LatticeEditorCommentsArgs {
  readonly path?: string;
  readonly includeResolved?: boolean;
  readonly offset?: number;
  readonly limit?: number;
}
export interface LatticeEditorCommentsRequest {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly args: LatticeEditorCommentsArgs;
  readonly expiresAt: number;
}
export interface LatticeEditorCommentsResult {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}
export class LatticeEditorCommentsBrokerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface LatticeEditorCommentsBrokerShape {
  readonly invoke: (
    workspaceRoot: string,
    args: LatticeEditorCommentsArgs,
  ) => Effect.Effect<unknown, LatticeEditorCommentsBrokerError>;
  readonly poll: (workspaceRoot: string) => Effect.Effect<LatticeEditorCommentsRequest | null>;
  readonly complete: (
    workspaceRoot: string,
    id: string,
    result: LatticeEditorCommentsResult,
  ) => Effect.Effect<boolean>;
}
export class LatticeEditorCommentsBroker extends ServiceMap.Service<
  LatticeEditorCommentsBroker,
  LatticeEditorCommentsBrokerShape
>()("synara/agentGateway/Services/LatticeEditorCommentsBroker") {}

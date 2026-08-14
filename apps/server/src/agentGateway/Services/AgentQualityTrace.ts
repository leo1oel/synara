import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

import type {
  AgentQualityPendingTurnContext,
  LatticeAgentCompileResult,
} from "../agentQualityTrace.ts";

export interface AgentQualityTraceShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly prepareTurnContext: (input: AgentQualityPendingTurnContext) => Effect.Effect<void>;
  readonly failTurnContext: (input: {
    readonly threadId: string;
    readonly messageId: string;
  }) => Effect.Effect<void>;
  readonly recordCompile: (result: LatticeAgentCompileResult) => Effect.Effect<void>;
}

export class AgentQualityTrace extends ServiceMap.Service<
  AgentQualityTrace,
  AgentQualityTraceShape
>()("synara/agentGateway/Services/AgentQualityTrace") {}

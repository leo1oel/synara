import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

import type { LatticeAgentCompileResult } from "../agentQualityTrace.ts";

export interface AgentQualityTraceShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly recordCompile: (result: LatticeAgentCompileResult) => Effect.Effect<void>;
}

export class AgentQualityTrace extends ServiceMap.Service<
  AgentQualityTrace,
  AgentQualityTraceShape
>()("synara/agentGateway/Services/AgentQualityTrace") {}

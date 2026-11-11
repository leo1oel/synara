import { ServiceMap } from "effect";
import type { Effect } from "effect";

/** The Lattice host tools whose requests the embedded agent panel answers. */
export type LatticeHostTool =
  | "bibliography"
  | "canvas"
  | "spreadsheet"
  | "projectDocument"
  | "editorComments"
  | "presentation";

/** One tool request on its way to the host, tagged with the tool that answers it. */
export interface LatticeHostToolDelivery {
  readonly tool: LatticeHostTool;
  readonly request: { readonly id: string };
}

export interface LatticeHostToolQueueShape {
  /** Hands `request` to the workspace's waiting poll, or queues it for the next one. */
  readonly offer: (
    workspaceRoot: string,
    tool: LatticeHostTool,
    request: { readonly id: string },
  ) => void;
  /** Drops a request no poll has taken yet, because its tool call ended first. */
  readonly withdraw: (workspaceRoot: string, id: string) => void;
  /** Waits for the workspace's next request of any tool; null when the poll times out. */
  readonly poll: (workspaceRoot: string) => Effect.Effect<LatticeHostToolDelivery | null>;
}

export class LatticeHostToolQueue extends ServiceMap.Service<
  LatticeHostToolQueue,
  LatticeHostToolQueueShape
>()("synara/agentGateway/Services/LatticeHostToolQueue") {}

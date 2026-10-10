import { Effect, Layer } from "effect";

import {
  LatticeHostToolQueue,
  type LatticeHostToolDelivery,
  type LatticeHostToolQueueShape,
} from "../Services/LatticeHostToolQueue.ts";

export const LATTICE_HOST_TOOL_POLL_TIMEOUT_MS = 25_000;

// Every Lattice host tool shares this queue so the embedded agent panel holds
// a single long poll for all of them. A poll per tool held one HTTP/1.1
// connection each; once six tools polled at once they filled WebKit's
// six-connection pool for the sidecar origin, and the panel's own scripts and
// requests waited a full poll cycle before it could finish restoring.
export function makeLatticeHostToolQueue(options?: {
  readonly pollTimeoutMs?: number;
}): LatticeHostToolQueueShape {
  const queues = new Map<string, LatticeHostToolDelivery[]>();
  const pollers = new Map<string, Array<(delivery: LatticeHostToolDelivery | null) => void>>();
  const pollTimeoutMs = options?.pollTimeoutMs ?? LATTICE_HOST_TOOL_POLL_TIMEOUT_MS;

  return {
    offer: (workspaceRoot, tool, request) => {
      const delivery = { tool, request } satisfies LatticeHostToolDelivery;
      const poller = pollers.get(workspaceRoot)?.shift();
      if (poller) {
        poller(delivery);
        return;
      }
      const queue = queues.get(workspaceRoot) ?? [];
      queue.push(delivery);
      queues.set(workspaceRoot, queue);
    },
    withdraw: (workspaceRoot, id) => {
      const queue = queues.get(workspaceRoot) ?? [];
      const index = queue.findIndex((delivery) => delivery.request.id === id);
      if (index >= 0) queue.splice(index, 1);
    },
    poll: (workspaceRoot) =>
      Effect.callback<LatticeHostToolDelivery | null>((resume) => {
        const queued = queues.get(workspaceRoot)?.shift();
        if (queued) {
          resume(Effect.succeed(queued));
          return;
        }
        let settled = false;
        const finish = (value: LatticeHostToolDelivery | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const workspacePollers = pollers.get(workspaceRoot) ?? [];
          const index = workspacePollers.indexOf(finish);
          if (index >= 0) workspacePollers.splice(index, 1);
          resume(Effect.succeed(value));
        };
        const timer = setTimeout(() => finish(null), pollTimeoutMs);
        const workspacePollers = pollers.get(workspaceRoot) ?? [];
        workspacePollers.push(finish);
        pollers.set(workspaceRoot, workspacePollers);
        return Effect.sync(() => finish(null));
      }),
  };
}

export const LatticeHostToolQueueLive = Layer.sync(LatticeHostToolQueue, makeLatticeHostToolQueue);

import { readEmbeddedHostAuthToken, readEmbedMode } from "./embedMode";

const POLL_PATH = "/api/lattice/host-tools/poll";

/** The Lattice host tools whose requests the embedded agent panel answers. */
export type LatticeHostTool =
  | "bibliography"
  | "canvas"
  | "spreadsheet"
  | "projectDocument"
  | "editorComments"
  | "presentation";

/** What a tool needs to answer one request through the host frame. */
export interface LatticeHostToolContext {
  readonly hostOrigin: string;
  readonly workspaceRoot: string;
  readonly token: string;
  readonly signal: AbortSignal;
}

/** Asks the host for one request's result and submits it to the tool's result route. */
export type LatticeHostToolHandler = (
  request: unknown,
  context: LatticeHostToolContext,
) => Promise<void>;

/**
 * The agent panel's one long poll for every Lattice host tool. HTTP/1.1 gives
 * a page six connections to the sidecar, and a 25-second poll per tool held
 * one each: with six tools the polls filled WebKit's whole pool, so the
 * panel's own scripts and requests queued behind them for a full poll cycle
 * and the panel sat on "Restoring the conversation surface" until then.
 *
 * Each tool still answers its requests one at a time, in arrival order, as its
 * own poll loop did; a slow tool no longer holds back the poll for the others.
 */
export function startLatticeHostToolRelay(
  handlers: Record<LatticeHostTool, LatticeHostToolHandler>,
): () => void {
  const config = readEmbedMode();
  const token = readEmbeddedHostAuthToken();
  if (!config?.hostOrigin || config.surface !== "chrome" || !token || window.parent === window)
    return () => undefined;
  const controller = new AbortController();
  const context: LatticeHostToolContext = {
    hostOrigin: config.hostOrigin,
    workspaceRoot: config.workspaceRoot,
    token,
    signal: controller.signal,
  };
  const answering = new Map<LatticeHostTool, Promise<void>>();
  const answer = (tool: LatticeHostTool, request: unknown) => {
    const previous = answering.get(tool) ?? Promise.resolve();
    answering.set(
      tool,
      previous.then(() => handlers[tool](request, context)).catch(() => undefined),
    );
  };
  const run = async () => {
    while (!controller.signal.aborted) {
      try {
        const response = await fetch(
          `${POLL_PATH}?${new URLSearchParams({ workspaceRoot: config.workspaceRoot })}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (response.status === 204) continue;
        if (!response.ok) throw new Error(`Host tool poll failed (${String(response.status)}).`);
        const delivery = (await response.json()) as { tool?: unknown; request?: unknown } | null;
        const tool = delivery?.tool;
        if (typeof tool !== "string" || !Object.hasOwn(handlers, tool))
          throw new Error("Host tool poll returned an unknown tool.");
        answer(tool as LatticeHostTool, delivery?.request);
      } catch {
        if (!controller.signal.aborted)
          await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
    }
  };
  void run();
  return () => controller.abort();
}

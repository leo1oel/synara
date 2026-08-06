import { readEmbedMode } from "./embedMode";

export const SYNARA_CANVAS_TOOL_REQUEST = "synara:canvas-tool-request";
export const LATTICE_CANVAS_TOOL_RESULT = "lattice:canvas-tool-result";
const POLL_PATH = "/api/lattice/canvas-tools/poll";
const RESULT_PATH = "/api/lattice/canvas-tools/result";
const HOST_TIMEOUT_MS = 30_000;

interface CanvasRequest {
  readonly id: string;
  readonly action: "list" | "create" | "update" | "delete";
  readonly args: Record<string, unknown>;
  readonly expiresAt: number;
}

interface CanvasResult {
  readonly type: typeof LATTICE_CANVAS_TOOL_RESULT;
  readonly version: 1;
  readonly id: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

function readAuthToken(): string | null {
  return sessionStorage.getItem("synara.poc.embed-auth-token")?.trim() || null;
}

export function awaitCanvasHostResult(
  request: CanvasRequest,
  hostOrigin: string,
  timeoutMs = HOST_TIMEOUT_MS,
): Promise<CanvasResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CanvasResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== hostOrigin) return;
      const data = event.data as Partial<CanvasResult> | null;
      if (
        !data ||
        data.type !== LATTICE_CANVAS_TOOL_RESULT ||
        data.version !== 1 ||
        data.id !== request.id ||
        typeof data.ok !== "boolean"
      )
        return;
      if (
        !data.ok &&
        (!data.error ||
          typeof data.error.code !== "string" ||
          typeof data.error.message !== "string")
      )
        return;
      finish(data as CanvasResult);
    };
    const timer = window.setTimeout(
      () =>
        finish({
          type: LATTICE_CANVAS_TOOL_RESULT,
          version: 1,
          id: request.id,
          ok: false,
          error: {
            code: "canvas_host_timeout",
            message: "The canvas host did not respond within 30 seconds.",
          },
        }),
      timeoutMs,
    );
    window.addEventListener("message", onMessage);
    window.parent.postMessage(
      {
        type: SYNARA_CANVAS_TOOL_REQUEST,
        version: 1,
        id: request.id,
        action: request.action,
        args: request.args,
        expiresAt: request.expiresAt,
      },
      hostOrigin,
    );
  });
}

async function submitResult(
  id: string,
  result: CanvasResult,
  token: string,
  workspaceRoot: string,
  signal: AbortSignal,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${RESULT_PATH}?${new URLSearchParams({ workspaceRoot })}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          result: {
            ok: result.ok,
            ...(result.result === undefined ? {} : { result: result.result }),
            ...(result.error ? { error: result.error } : {}),
          },
        }),
        signal,
      });
      if (response.ok || response.status === 409) return;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 200 * (attempt + 1)));
  }
}

export function startLatticeCanvasRelay(): () => void {
  const config = readEmbedMode();
  const token = readAuthToken();
  if (!config?.hostOrigin || config.surface !== "chrome" || !token || window.parent === window)
    return () => undefined;
  const controller = new AbortController();
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
        if (!response.ok) throw new Error(`Canvas poll failed (${response.status}).`);
        const request = (await response.json()) as CanvasRequest;
        const result: CanvasResult =
          request.expiresAt <= Date.now()
            ? {
                type: LATTICE_CANVAS_TOOL_RESULT,
                version: 1 as const,
                id: request.id,
                ok: false,
                error: {
                  code: "canvas_tool_expired",
                  message: "The canvas request expired before execution.",
                },
              }
            : await awaitCanvasHostResult(request, config.hostOrigin!);
        await submitResult(request.id, result, token, config.workspaceRoot, controller.signal);
      } catch {
        if (!controller.signal.aborted)
          await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
    }
  };
  void run();
  return () => controller.abort();
}

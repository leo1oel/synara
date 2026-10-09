import { readEmbeddedHostAuthToken, readEmbedMode } from "./embedMode";

export const SYNARA_PRESENTATION_TOOL_REQUEST = "synara:presentation-tool-request";
export const LATTICE_PRESENTATION_TOOL_RESULT = "lattice:presentation-tool-result";
const POLL_PATH = "/api/lattice/presentation-tools/poll";
const RESULT_PATH = "/api/lattice/presentation-tools/result";

interface PresentationRequest {
  readonly id: string;
  readonly action: "preview_page";
  readonly args: Record<string, unknown>;
  readonly expiresAt: number;
}

interface PresentationResult {
  readonly type: typeof LATTICE_PRESENTATION_TOOL_RESULT;
  readonly version: 1;
  readonly id: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

function failure(id: string, code: string, message: string): PresentationResult {
  return {
    type: LATTICE_PRESENTATION_TOOL_RESULT,
    version: 1,
    id,
    ok: false,
    error: { code, message },
  };
}

// The host may have to start its presentation runtime before it renders the
// page, so it answers within the request's own deadline rather than a fixed one.
export function awaitPresentationHostResult(
  request: PresentationRequest,
  hostOrigin: string,
): Promise<PresentationResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: PresentationResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== hostOrigin) return;
      const data = event.data as Partial<PresentationResult> | null;
      if (
        !data ||
        data.type !== LATTICE_PRESENTATION_TOOL_RESULT ||
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
      finish(data as PresentationResult);
    };
    const timer = window.setTimeout(
      () =>
        finish(
          failure(
            request.id,
            "presentation_host_timeout",
            "The presentation host did not respond before the request deadline.",
          ),
        ),
      Math.max(0, request.expiresAt - Date.now()),
    );
    window.addEventListener("message", onMessage);
    window.parent.postMessage(
      {
        type: SYNARA_PRESENTATION_TOOL_REQUEST,
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
  result: PresentationResult,
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

export function startLatticePresentationRelay(): () => void {
  const config = readEmbedMode();
  const token = readEmbeddedHostAuthToken();
  if (!config?.hostOrigin || config.surface !== "chrome" || !token || window.parent === window)
    return () => undefined;
  const hostOrigin = config.hostOrigin;
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
        if (!response.ok) throw new Error(`Presentation poll failed (${response.status}).`);
        const request = (await response.json()) as PresentationRequest;
        // Each request waits on its own, so a slow page render does not hold
        // back the next poll.
        void (
          request.expiresAt <= Date.now()
            ? Promise.resolve(
                failure(
                  request.id,
                  "presentation_tool_expired",
                  "The presentation request expired before execution.",
                ),
              )
            : awaitPresentationHostResult(request, hostOrigin)
        )
          .then((result) =>
            submitResult(request.id, result, token, config.workspaceRoot, controller.signal),
          )
          .catch(() => undefined);
      } catch {
        if (!controller.signal.aborted)
          await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
    }
  };
  void run();
  return () => controller.abort();
}

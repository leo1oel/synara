import { readEmbedMode } from "./embedMode";

export const SYNARA_BIBLIOGRAPHY_TOOL_REQUEST = "synara:bibliography-tool-request";
export const LATTICE_BIBLIOGRAPHY_TOOL_RESULT = "lattice:bibliography-tool-result";
const POLL_PATH = "/api/lattice/bibliography-tools/poll";
const RESULT_PATH = "/api/lattice/bibliography-tools/result";
const HOST_TIMEOUT_MS = 30_000;
const MAX_RESULT_BYTES = 384 * 1024;

type BibliographyAction = "cite" | "upgrade_bibliography" | "remove_reference";

export interface BibliographyRequest {
  readonly id: string;
  readonly action: BibliographyAction;
  readonly params: Record<string, unknown>;
  readonly expiresAt: number;
}

export interface BibliographyResult {
  readonly type: typeof LATTICE_BIBLIOGRAPHY_TOOL_RESULT;
  readonly version: 1;
  readonly id: string;
  readonly ok: boolean;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: string; readonly message: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlyArray<string>): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function jsonBytes(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return null;
  }
}

function hasBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function hasValidParams(action: BibliographyAction, params: Record<string, unknown>): boolean {
  if (action === "cite") {
    return hasOnlyKeys(params, ["query"]) && hasBoundedString(params.query, 4_096);
  }
  if (action === "upgrade_bibliography") {
    return (
      hasOnlyKeys(params, ["dryRun"]) &&
      (params.dryRun === undefined || typeof params.dryRun === "boolean")
    );
  }
  return hasOnlyKeys(params, ["key"]) && hasBoundedString(params.key, 512);
}

export function parseBibliographyRequest(value: unknown): BibliographyRequest | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "action", "params", "expiresAt"])) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > 128 ||
    (value.action !== "cite" &&
      value.action !== "upgrade_bibliography" &&
      value.action !== "remove_reference") ||
    !isRecord(value.params) ||
    !hasValidParams(value.action, value.params) ||
    typeof value.expiresAt !== "number" ||
    !Number.isFinite(value.expiresAt)
  ) {
    return null;
  }
  return value as unknown as BibliographyRequest;
}

function invalidHostResult(id: string, code: string, message: string): BibliographyResult {
  return {
    type: LATTICE_BIBLIOGRAPHY_TOOL_RESULT,
    version: 1,
    id,
    ok: false,
    error: { code, message },
  };
}

function parseHostResult(value: Record<string, unknown>, id: string): BibliographyResult {
  if (
    !hasOnlyKeys(value, ["type", "version", "id", "ok", "result", "error"]) ||
    typeof value.ok !== "boolean"
  ) {
    return invalidHostResult(
      id,
      "bibliography_host_invalid_result",
      "The bibliography host returned an invalid result envelope.",
    );
  }
  if (value.ok) {
    const resultBytes = jsonBytes(value.result);
    if (
      value.error !== undefined ||
      !isRecord(value.result) ||
      resultBytes === null ||
      resultBytes > MAX_RESULT_BYTES
    ) {
      return invalidHostResult(
        id,
        "bibliography_host_invalid_result",
        "The bibliography host returned an invalid success result.",
      );
    }
    return value as unknown as BibliographyResult;
  }
  if (value.result !== undefined || !isRecord(value.error)) {
    return invalidHostResult(
      id,
      "bibliography_host_invalid_result",
      "The bibliography host returned an invalid error result.",
    );
  }
  if (
    !hasOnlyKeys(value.error, ["code", "message"]) ||
    typeof value.error.code !== "string" ||
    value.error.code.length === 0 ||
    value.error.code.length > 128 ||
    typeof value.error.message !== "string" ||
    value.error.message.length === 0 ||
    value.error.message.length > 2_000
  ) {
    return invalidHostResult(
      id,
      "bibliography_host_invalid_result",
      "The bibliography host returned an invalid error payload.",
    );
  }
  return value as unknown as BibliographyResult;
}

function readAuthToken(): string | null {
  return sessionStorage.getItem("synara.poc.embed-auth-token")?.trim() || null;
}

export function awaitBibliographyHostResult(
  request: BibliographyRequest,
  hostOrigin: string,
  workspaceRoot: string,
  timeoutMs = HOST_TIMEOUT_MS,
): Promise<BibliographyResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: BibliographyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== hostOrigin || !isRecord(event.data)) {
        return;
      }
      const data = event.data;
      if (
        data.type !== LATTICE_BIBLIOGRAPHY_TOOL_RESULT ||
        data.version !== 1 ||
        data.id !== request.id
      ) {
        return;
      }
      finish(parseHostResult(data, request.id));
    };
    const timer = window.setTimeout(
      () =>
        finish(
          invalidHostResult(
            request.id,
            "bibliography_host_timeout",
            "The bibliography host did not respond before the request deadline.",
          ),
        ),
      timeoutMs,
    );
    window.addEventListener("message", onMessage);
    window.parent.postMessage(
      {
        type: SYNARA_BIBLIOGRAPHY_TOOL_REQUEST,
        version: 1,
        id: request.id,
        action: request.action,
        params: request.params,
        workspaceRoot,
        expiresAt: request.expiresAt,
      },
      hostOrigin,
    );
  });
}

async function submitResult(
  id: string,
  result: BibliographyResult,
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

export function startLatticeBibliographyRelay(): () => void {
  const config = readEmbedMode();
  const token = readAuthToken();
  if (!config?.hostOrigin || config.surface !== "chrome" || !token || window.parent === window) {
    return () => undefined;
  }
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
        if (!response.ok) throw new Error(`Bibliography poll failed (${String(response.status)}).`);
        const request = parseBibliographyRequest(await response.json());
        if (!request) throw new Error("Bibliography poll returned an invalid request.");
        const result =
          request.expiresAt <= Date.now()
            ? invalidHostResult(
                request.id,
                "bibliography_tool_expired",
                "The bibliography request expired before execution.",
              )
            : await awaitBibliographyHostResult(
                request,
                hostOrigin,
                config.workspaceRoot,
                Math.min(HOST_TIMEOUT_MS, request.expiresAt - Date.now()),
              );
        await submitResult(request.id, result, token, config.workspaceRoot, controller.signal);
      } catch {
        if (!controller.signal.aborted) {
          await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
      }
    }
  };
  void run();
  return () => controller.abort();
}

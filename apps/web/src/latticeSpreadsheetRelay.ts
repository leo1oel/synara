import { readEmbedMode } from "./embedMode";

export const SYNARA_SPREADSHEET_TOOL_REQUEST = "synara:spreadsheet-tool-request";
export const LATTICE_SPREADSHEET_TOOL_RESULT = "lattice:spreadsheet-tool-result";
const POLL_PATH = "/api/lattice/spreadsheet-tools/poll";
const RESULT_PATH = "/api/lattice/spreadsheet-tools/result";
const HOST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESULT_BYTES = 384 * 1024;

export interface SpreadsheetRequest {
  readonly id: string;
  readonly action: "read" | "batch_update";
  readonly args: Record<string, unknown>;
  readonly expiresAt: number;
}

export interface SpreadsheetResult {
  readonly type: typeof LATTICE_SPREADSHEET_TOOL_RESULT;
  readonly version: 1;
  readonly id: string;
  readonly ok: boolean;
  readonly result?: unknown;
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

export function parseSpreadsheetRequest(value: unknown): SpreadsheetRequest | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "action", "args", "expiresAt"])) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > 128 ||
    (value.action !== "read" && value.action !== "batch_update") ||
    !isRecord(value.args) ||
    typeof value.expiresAt !== "number" ||
    !Number.isFinite(value.expiresAt)
  ) {
    return null;
  }
  const requestBytes = jsonBytes(value.args);
  return requestBytes !== null && requestBytes <= MAX_REQUEST_BYTES
    ? (value as unknown as SpreadsheetRequest)
    : null;
}

function invalidHostResult(id: string, code: string, message: string): SpreadsheetResult {
  return {
    type: LATTICE_SPREADSHEET_TOOL_RESULT,
    version: 1,
    id,
    ok: false,
    error: { code, message },
  };
}

function parseHostResult(value: Record<string, unknown>, id: string): SpreadsheetResult {
  if (
    !hasOnlyKeys(value, ["type", "version", "id", "ok", "result", "error"]) ||
    typeof value.ok !== "boolean"
  ) {
    return invalidHostResult(
      id,
      "spreadsheet_host_invalid_result",
      "The spreadsheet host returned an invalid result envelope.",
    );
  }
  if (value.ok) {
    if (value.error !== undefined) {
      return invalidHostResult(
        id,
        "spreadsheet_host_invalid_result",
        "The spreadsheet host returned both a success and an error.",
      );
    }
    if (value.result !== undefined) {
      const resultBytes = jsonBytes(value.result);
      if (resultBytes === null || resultBytes > MAX_RESULT_BYTES) {
        return invalidHostResult(
          id,
          "spreadsheet_result_too_large",
          "The spreadsheet host result exceeded the relay payload limit.",
        );
      }
    }
    return value as unknown as SpreadsheetResult;
  }
  if (value.result !== undefined || !isRecord(value.error)) {
    return invalidHostResult(
      id,
      "spreadsheet_host_invalid_result",
      "The spreadsheet host returned an invalid error result.",
    );
  }
  const error = value.error;
  if (
    !hasOnlyKeys(error, ["code", "message"]) ||
    typeof error.code !== "string" ||
    error.code.length === 0 ||
    error.code.length > 128 ||
    typeof error.message !== "string" ||
    error.message.length === 0 ||
    error.message.length > 2_000
  ) {
    return invalidHostResult(
      id,
      "spreadsheet_host_invalid_result",
      "The spreadsheet host returned an invalid error payload.",
    );
  }
  return value as unknown as SpreadsheetResult;
}

function readAuthToken(): string | null {
  return sessionStorage.getItem("synara.poc.embed-auth-token")?.trim() || null;
}

export function awaitSpreadsheetHostResult(
  request: SpreadsheetRequest,
  hostOrigin: string,
  timeoutMs = HOST_TIMEOUT_MS,
): Promise<SpreadsheetResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SpreadsheetResult) => {
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
        data.type !== LATTICE_SPREADSHEET_TOOL_RESULT ||
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
            "spreadsheet_host_timeout",
            "The spreadsheet host did not respond before the request deadline.",
          ),
        ),
      timeoutMs,
    );
    window.addEventListener("message", onMessage);
    window.parent.postMessage(
      {
        type: SYNARA_SPREADSHEET_TOOL_REQUEST,
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
  result: SpreadsheetResult,
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

export function startLatticeSpreadsheetRelay(): () => void {
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
        if (!response.ok) throw new Error(`Spreadsheet poll failed (${String(response.status)}).`);
        const request = parseSpreadsheetRequest(await response.json());
        if (!request) throw new Error("Spreadsheet poll returned an invalid request.");
        const result =
          request.expiresAt <= Date.now()
            ? invalidHostResult(
                request.id,
                "spreadsheet_tool_expired",
                "The spreadsheet request expired before execution.",
              )
            : await awaitSpreadsheetHostResult(
                request,
                hostOrigin,
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

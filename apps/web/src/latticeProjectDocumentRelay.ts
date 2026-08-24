import { readEmbedMode } from "./embedMode";

export const SYNARA_PROJECT_DOCUMENT_TOOL_REQUEST = "synara:project-document-tool-request";
export const LATTICE_PROJECT_DOCUMENT_TOOL_RESULT = "lattice:project-document-tool-result";
const POLL_PATH = "/api/lattice/project-document-tools/poll";
const RESULT_PATH = "/api/lattice/project-document-tools/result";
const HOST_TIMEOUT_MS = 30_000;

type ProjectDocumentType = "board" | "spreadsheet";

export interface ProjectDocumentRequest {
  readonly id: string;
  readonly args: { readonly path: string; readonly documentType: ProjectDocumentType };
  readonly expiresAt: number;
}

export interface ProjectDocumentResult {
  readonly type: typeof LATTICE_PROJECT_DOCUMENT_TOOL_RESULT;
  readonly version: 1;
  readonly id: string;
  readonly ok: boolean;
  readonly result?: {
    readonly path: string;
    readonly documentType: ProjectDocumentType;
    readonly opened: true;
  };
  readonly error?: { readonly code: string; readonly message: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlyArray<string>): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1_024 &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/.test(value) &&
    !value.includes("\\") &&
    value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function hasExpectedExtension(path: string, documentType: ProjectDocumentType): boolean {
  return path
    .toLocaleLowerCase("en-US")
    .endsWith(documentType === "board" ? ".tldr" : ".lattice-sheet");
}

export function parseProjectDocumentRequest(value: unknown): ProjectDocumentRequest | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "args", "expiresAt"])) return null;
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > 128 ||
    typeof value.expiresAt !== "number" ||
    !Number.isFinite(value.expiresAt) ||
    !isRecord(value.args) ||
    !hasOnlyKeys(value.args, ["path", "documentType"]) ||
    !isPath(value.args.path) ||
    (value.args.documentType !== "board" && value.args.documentType !== "spreadsheet") ||
    !hasExpectedExtension(value.args.path, value.args.documentType)
  ) {
    return null;
  }
  return value as unknown as ProjectDocumentRequest;
}

function invalidHostResult(id: string, code: string, message: string): ProjectDocumentResult {
  return {
    type: LATTICE_PROJECT_DOCUMENT_TOOL_RESULT,
    version: 1,
    id,
    ok: false,
    error: { code, message },
  };
}

function parseHostResult(
  value: Record<string, unknown>,
  request: ProjectDocumentRequest,
): ProjectDocumentResult {
  const { id } = request;
  if (
    !hasOnlyKeys(value, ["type", "version", "id", "ok", "result", "error"]) ||
    typeof value.ok !== "boolean"
  ) {
    return invalidHostResult(
      id,
      "project_document_host_invalid_result",
      "The project document host returned an invalid result envelope.",
    );
  }
  if (value.ok) {
    if (
      value.error !== undefined ||
      !isRecord(value.result) ||
      !hasOnlyKeys(value.result, ["path", "documentType", "opened"]) ||
      !isPath(value.result.path) ||
      (value.result.documentType !== "board" && value.result.documentType !== "spreadsheet") ||
      value.result.path !== request.args.path ||
      value.result.documentType !== request.args.documentType ||
      value.result.opened !== true
    ) {
      return invalidHostResult(
        id,
        "project_document_host_invalid_result",
        "The project document host returned an invalid success result.",
      );
    }
    return value as unknown as ProjectDocumentResult;
  }
  if (value.result !== undefined || !isRecord(value.error)) {
    return invalidHostResult(
      id,
      "project_document_host_invalid_result",
      "The project document host returned an invalid error result.",
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
      "project_document_host_invalid_result",
      "The project document host returned an invalid error payload.",
    );
  }
  return value as unknown as ProjectDocumentResult;
}

function readAuthToken(): string | null {
  return sessionStorage.getItem("synara.poc.embed-auth-token")?.trim() || null;
}

export function awaitProjectDocumentHostResult(
  request: ProjectDocumentRequest,
  hostOrigin: string,
  timeoutMs = HOST_TIMEOUT_MS,
): Promise<ProjectDocumentResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ProjectDocumentResult) => {
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
        data.type !== LATTICE_PROJECT_DOCUMENT_TOOL_RESULT ||
        data.version !== 1 ||
        data.id !== request.id
      ) {
        return;
      }
      finish(parseHostResult(data, request));
    };
    const timer = window.setTimeout(
      () =>
        finish(
          invalidHostResult(
            request.id,
            "project_document_host_timeout",
            "The project document host did not respond before the request deadline.",
          ),
        ),
      timeoutMs,
    );
    window.addEventListener("message", onMessage);
    window.parent.postMessage(
      {
        type: SYNARA_PROJECT_DOCUMENT_TOOL_REQUEST,
        version: 1,
        id: request.id,
        args: request.args,
        expiresAt: request.expiresAt,
      },
      hostOrigin,
    );
  });
}

async function submitResult(
  id: string,
  result: ProjectDocumentResult,
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

export function startLatticeProjectDocumentRelay(): () => void {
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
        if (!response.ok) {
          throw new Error(`Project document poll failed (${String(response.status)}).`);
        }
        const request = parseProjectDocumentRequest(await response.json());
        if (!request) throw new Error("Project document poll returned an invalid request.");
        const result =
          request.expiresAt <= Date.now()
            ? invalidHostResult(
                request.id,
                "project_document_tool_expired",
                "The project document request expired before execution.",
              )
            : await awaitProjectDocumentHostResult(
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

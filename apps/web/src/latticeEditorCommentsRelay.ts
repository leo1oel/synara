import { readEmbeddedHostAuthToken, readEmbedMode } from "./embedMode";
export const SYNARA_EDITOR_COMMENTS_TOOL_REQUEST = "synara:editor-comments-tool-request";
export const LATTICE_EDITOR_COMMENTS_TOOL_RESULT = "lattice:editor-comments-tool-result";
type Request = {
  id: string;
  workspaceRoot: string;
  args: { path?: string; includeResolved?: boolean; offset?: number; limit?: number };
  expiresAt: number;
};
type HostResult = {
  type: typeof LATTICE_EDITOR_COMMENTS_TOOL_RESULT;
  version: 1;
  id: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const bounded = (value: unknown, max: number, nonempty = false): value is string =>
  typeof value === "string" && value.length <= max && (!nonempty || value.trim().length > 0);
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
function validCollection(value: unknown, workspaceRoot: string): value is Record<string, unknown> {
  if (
    !record(value) ||
    !only(value, [
      "workspaceRoot",
      "capturedAt",
      "comments",
      "omittedCount",
      "overleaf",
      "totalCount",
      "offset",
      "nextOffset",
    ]) ||
    !nonnegative(value.totalCount) ||
    !nonnegative(value.offset) ||
    (value.nextOffset !== null && !nonnegative(value.nextOffset)) ||
    value.workspaceRoot !== workspaceRoot ||
    !bounded(value.capturedAt, 128, true) ||
    !Array.isArray(value.comments) ||
    value.comments.length > 1_000 ||
    !nonnegative(value.omittedCount) ||
    !record(value.overleaf) ||
    !only(value.overleaf, ["status", "fetchedAt", "error"])
  )
    return false;
  if (
    !["not-linked", "fresh", "cached", "unavailable"].includes(String(value.overleaf.status)) ||
    (value.overleaf.fetchedAt !== undefined && !bounded(value.overleaf.fetchedAt, 128, true)) ||
    (value.overleaf.error !== undefined && !bounded(value.overleaf.error, 2_000))
  )
    return false;
  return value.comments.every((comment) => {
    if (
      !record(comment) ||
      !only(comment, [
        "id",
        "origin",
        "path",
        "from",
        "to",
        "quote",
        "body",
        "authorName",
        "resolved",
        "replies",
        "updatedAt",
        "anchorStatus",
      ]) ||
      !bounded(comment.id, 256, true) ||
      (comment.origin !== "local" && comment.origin !== "overleaf") ||
      !bounded(comment.path, 4_096) ||
      !nonnegative(comment.from) ||
      !nonnegative(comment.to) ||
      !bounded(comment.quote, 12_000) ||
      !bounded(comment.body, 20_000) ||
      !bounded(comment.authorName, 1_024) ||
      typeof comment.resolved !== "boolean" ||
      !Array.isArray(comment.replies) ||
      comment.replies.length > 1_000 ||
      !bounded(comment.updatedAt, 128, true) ||
      !["exact", "moved", "missing", "unchecked"].includes(String(comment.anchorStatus))
    )
      return false;
    return comment.replies.every(
      (reply) =>
        record(reply) &&
        only(reply, ["authorName", "body", "createdAt"]) &&
        bounded(reply.authorName, 1_024) &&
        bounded(reply.body, 20_000) &&
        bounded(reply.createdAt, 128, true),
    );
  });
}
function valid(value: unknown, workspaceRoot: string): value is Request {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    item.workspaceRoot === workspaceRoot &&
    typeof item.expiresAt === "number" &&
    Boolean(item.args) &&
    typeof item.args === "object"
  );
}
function invalid(id: string): HostResult {
  return {
    type: LATTICE_EDITOR_COMMENTS_TOOL_RESULT,
    version: 1,
    id,
    ok: false,
    error: {
      code: "editor_comments_host_invalid_result",
      message: "The editor comments host returned an invalid result.",
    },
  };
}
function parseResult(value: Record<string, unknown>, request: Request): HostResult {
  if (
    !only(value, ["type", "version", "id", "ok", "result", "error"]) ||
    typeof value.ok !== "boolean"
  )
    return invalid(request.id);
  if (value.ok) {
    if (value.error !== undefined || !validCollection(value.result, request.workspaceRoot))
      return invalid(request.id);
  } else if (
    value.result !== undefined ||
    !record(value.error) ||
    !only(value.error, ["code", "message"]) ||
    typeof value.error.code !== "string" ||
    !value.error.code ||
    value.error.code.length > 128 ||
    typeof value.error.message !== "string" ||
    !value.error.message ||
    value.error.message.length > 2_000
  )
    return invalid(request.id);
  return value as unknown as HostResult;
}

export function awaitEditorCommentsHostResult(
  request: Request,
  hostOrigin: string,
  signal: AbortSignal,
): Promise<HostResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: HostResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("message", listener);
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const listener = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== hostOrigin || !record(event.data))
        return;
      const data = event.data;
      if (
        data.type !== LATTICE_EDITOR_COMMENTS_TOOL_RESULT ||
        data.version !== 1 ||
        data.id !== request.id
      )
        return;
      finish(parseResult(data, request));
    };
    const onAbort = () =>
      finish({
        type: LATTICE_EDITOR_COMMENTS_TOOL_RESULT,
        version: 1,
        id: request.id,
        ok: false,
        error: {
          code: "editor_comments_relay_stopped",
          message: "The editor comments relay stopped.",
        },
      });
    const timer = window.setTimeout(
      () =>
        finish({
          type: LATTICE_EDITOR_COMMENTS_TOOL_RESULT,
          version: 1,
          id: request.id,
          ok: false,
          error: {
            code: "editor_comments_host_timeout",
            message: "The host did not respond before the deadline.",
          },
        }),
      Math.max(0, request.expiresAt - Date.now()),
    );
    window.addEventListener("message", listener);
    signal.addEventListener("abort", onAbort, { once: true });
    window.parent.postMessage(
      {
        type: SYNARA_EDITOR_COMMENTS_TOOL_REQUEST,
        version: 1,
        id: request.id,
        workspaceRoot: request.workspaceRoot,
        args: request.args,
        expiresAt: request.expiresAt,
      },
      hostOrigin,
    );
  });
}
export function startLatticeEditorCommentsRelay(): () => void {
  const config = readEmbedMode();
  const auth = readEmbeddedHostAuthToken();
  if (!config?.hostOrigin || config.surface !== "chrome" || !auth || window.parent === window)
    return () => undefined;
  const hostOrigin = config.hostOrigin;
  const controller = new AbortController();
  void (async () => {
    while (!controller.signal.aborted) {
      try {
        const query = new URLSearchParams({ workspaceRoot: config.workspaceRoot });
        const response = await fetch(`/api/lattice/editor-comments-tools/poll?${query}`, {
          headers: { Authorization: `Bearer ${auth}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 204) {
          await new Promise((resolve) => window.setTimeout(resolve, 250));
          continue;
        }
        if (!response.ok) throw new Error("poll failed");
        const request: unknown = await response.json();
        if (!valid(request, config.workspaceRoot)) throw new Error("invalid request");
        const result = await awaitEditorCommentsHostResult(request, hostOrigin, controller.signal);
        if (controller.signal.aborted) break;
        await fetch(`/api/lattice/editor-comments-tools/result?${query}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            id: request.id,
            result: {
              ok: result.ok,
              ...(result.result === undefined ? {} : { result: result.result }),
              ...(result.error === undefined ? {} : { error: result.error }),
            },
          }),
          signal: controller.signal,
        });
      } catch {
        if (!controller.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  })();
  return () => controller.abort();
}

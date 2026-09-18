import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { authErrorResponse } from "../auth/effectHttp.ts";
import { readMcpJsonBody } from "./httpRoute.ts";
import { authenticateLatticeRelayRequest } from "./latticeRelayAuthentication.ts";
import {
  LatticeEditorCommentsBroker,
  type LatticeEditorCommentsResult,
} from "./Services/LatticeEditorCommentsBroker.ts";
export const LATTICE_EDITOR_COMMENTS_POLL_PATH = "/api/lattice/editor-comments-tools/poll";
export const LATTICE_EDITOR_COMMENTS_RESULT_PATH = "/api/lattice/editor-comments-tools/result";
const root = (request: HttpServerRequest.HttpServerRequest) => {
  const value = HttpServerRequest.toURL(request)?.searchParams.get("workspaceRoot")?.trim();
  return value && value.length <= 4_096 ? value : null;
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const bounded = (value: unknown, max: number, nonempty = false): value is string =>
  typeof value === "string" && value.length <= max && (!nonempty || value.trim().length > 0);
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

function validComment(value: unknown): boolean {
  if (
    !record(value) ||
    !only(value, [
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
    ])
  )
    return false;
  if (
    !bounded(value.id, 256, true) ||
    (value.origin !== "local" && value.origin !== "overleaf") ||
    !bounded(value.path, 4_096) ||
    !nonnegative(value.from) ||
    !nonnegative(value.to) ||
    !bounded(value.quote, 12_000) ||
    !bounded(value.body, 20_000) ||
    !bounded(value.authorName, 1_024) ||
    typeof value.resolved !== "boolean" ||
    !Array.isArray(value.replies) ||
    value.replies.length > 1_000 ||
    !bounded(value.updatedAt, 128, true) ||
    !["exact", "moved", "missing", "unchecked"].includes(String(value.anchorStatus))
  )
    return false;
  return value.replies.every(
    (reply) =>
      record(reply) &&
      only(reply, ["authorName", "body", "createdAt"]) &&
      bounded(reply.authorName, 1_024) &&
      bounded(reply.body, 20_000) &&
      bounded(reply.createdAt, 128, true),
  );
}

function validCollection(value: unknown, workspaceRoot: string): boolean {
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
    !value.comments.every(validComment) ||
    !nonnegative(value.omittedCount) ||
    !record(value.overleaf) ||
    !only(value.overleaf, ["status", "fetchedAt", "error"])
  )
    return false;
  return (
    ["not-linked", "fresh", "cached", "unavailable"].includes(String(value.overleaf.status)) &&
    (value.overleaf.fetchedAt === undefined || bounded(value.overleaf.fetchedAt, 128, true)) &&
    (value.overleaf.error === undefined || bounded(value.overleaf.error, 2_000))
  );
}

export function isLatticeEditorCommentsResultBody(
  value: unknown,
  workspaceRoot: string,
): value is { id: string; result: LatticeEditorCommentsResult } {
  if (
    !record(value) ||
    !only(value, ["id", "result"]) ||
    !bounded(value.id, 128, true) ||
    !record(value.result) ||
    !only(value.result, ["ok", "result", "error"]) ||
    typeof value.result.ok !== "boolean"
  )
    return false;
  if (value.result.ok)
    return value.result.error === undefined && validCollection(value.result.result, workspaceRoot);
  return (
    value.result.result === undefined &&
    record(value.result.error) &&
    only(value.result.error, ["code", "message"]) &&
    bounded(value.result.error.code, 128, true) &&
    bounded(value.result.error.message, 2_000, true)
  );
}
const poll = HttpRouter.add(
  "GET",
  LATTICE_EDITOR_COMMENTS_POLL_PATH,
  Effect.gen(function* () {
    yield* authenticateLatticeRelayRequest;
    const workspaceRoot = root(yield* HttpServerRequest.HttpServerRequest);
    if (!workspaceRoot) return HttpServerResponse.text("Missing workspaceRoot", { status: 400 });
    const request = yield* (yield* LatticeEditorCommentsBroker).poll(workspaceRoot);
    return request
      ? HttpServerResponse.jsonUnsafe(request, { headers: { "Cache-Control": "no-store" } })
      : HttpServerResponse.empty({ status: 204, headers: { "Cache-Control": "no-store" } });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);
const result = HttpRouter.add(
  "POST",
  LATTICE_EDITOR_COMMENTS_RESULT_PATH,
  Effect.gen(function* () {
    yield* authenticateLatticeRelayRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const workspaceRoot = root(request);
    if (!workspaceRoot) return HttpServerResponse.text("Missing workspaceRoot", { status: 400 });
    const body = yield* readMcpJsonBody(request, 512 * 1024);
    if (body.kind === "too-large")
      return HttpServerResponse.text("Payload Too Large", { status: 413 });
    if (body.kind !== "ok" || !isLatticeEditorCommentsResultBody(body.body, workspaceRoot))
      return HttpServerResponse.text("Invalid result", { status: 400 });
    const accepted = yield* (yield* LatticeEditorCommentsBroker).complete(
      workspaceRoot,
      body.body.id,
      body.body.result,
    );
    return HttpServerResponse.jsonUnsafe({ accepted }, { status: accepted ? 200 : 409 });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);
export const latticeEditorCommentsRouteLayer = Layer.mergeAll(poll, result);

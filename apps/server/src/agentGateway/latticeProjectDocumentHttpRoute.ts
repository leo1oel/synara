import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { authErrorResponse } from "../auth/effectHttp.ts";
import { readMcpJsonBody } from "./httpRoute.ts";
import { authenticateLatticeRelayRequest } from "./latticeRelayAuthentication.ts";
import {
  LatticeProjectDocumentBroker,
  type LatticeProjectDocumentResult,
} from "./Services/LatticeProjectDocumentBroker.ts";

export const LATTICE_PROJECT_DOCUMENT_POLL_PATH = "/api/lattice/project-document-tools/poll";
export const LATTICE_PROJECT_DOCUMENT_RESULT_PATH = "/api/lattice/project-document-tools/result";
export const LATTICE_PROJECT_DOCUMENT_MAX_BODY_BYTES = 16 * 1024;

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

function isSuccessResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["path", "documentType", "opened"]) &&
    isPath(value.path) &&
    (value.documentType === "board" || value.documentType === "spreadsheet") &&
    value.path
      .toLocaleLowerCase("en-US")
      .endsWith(value.documentType === "board" ? ".tldr" : ".lattice-sheet") &&
    value.opened === true
  );
}

export function isLatticeProjectDocumentResultBody(
  value: unknown,
): value is { id: string; result: LatticeProjectDocumentResult } {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "result"])) return false;
  if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 128) return false;
  if (!isRecord(value.result) || !hasOnlyKeys(value.result, ["ok", "result", "error"])) {
    return false;
  }
  const result = value.result;
  if (typeof result.ok !== "boolean") return false;
  if (result.ok) return result.error === undefined && isSuccessResult(result.result);
  if (result.result !== undefined || !isRecord(result.error)) return false;
  return (
    hasOnlyKeys(result.error, ["code", "message"]) &&
    typeof result.error.code === "string" &&
    result.error.code.length > 0 &&
    result.error.code.length <= 128 &&
    typeof result.error.message === "string" &&
    result.error.message.length > 0 &&
    result.error.message.length <= 2_000
  );
}

function workspaceRootFromRequest(request: HttpServerRequest.HttpServerRequest): string | null {
  const value = HttpServerRequest.toURL(request)?.searchParams.get("workspaceRoot")?.trim();
  return value && value.length <= 4_096 ? value : null;
}

const pollRoute = HttpRouter.add(
  "GET",
  LATTICE_PROJECT_DOCUMENT_POLL_PATH,
  Effect.gen(function* () {
    yield* authenticateLatticeRelayRequest;
    const httpRequest = yield* HttpServerRequest.HttpServerRequest;
    const workspaceRoot = workspaceRootFromRequest(httpRequest);
    if (!workspaceRoot) return HttpServerResponse.text("Missing workspaceRoot", { status: 400 });
    const broker = yield* LatticeProjectDocumentBroker;
    const request = yield* broker.poll(workspaceRoot);
    return request
      ? HttpServerResponse.jsonUnsafe(request, {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        })
      : HttpServerResponse.empty({ status: 204, headers: { "Cache-Control": "no-store" } });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

const resultRoute = HttpRouter.add(
  "POST",
  LATTICE_PROJECT_DOCUMENT_RESULT_PATH,
  Effect.gen(function* () {
    yield* authenticateLatticeRelayRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const workspaceRoot = workspaceRootFromRequest(request);
    if (!workspaceRoot) return HttpServerResponse.text("Missing workspaceRoot", { status: 400 });
    const body = yield* readMcpJsonBody(request, LATTICE_PROJECT_DOCUMENT_MAX_BODY_BYTES);
    if (body.kind === "too-large") {
      return HttpServerResponse.text("Payload Too Large", { status: 413 });
    }
    if (body.kind !== "ok" || !isLatticeProjectDocumentResultBody(body.body)) {
      return HttpServerResponse.jsonUnsafe(
        { error: "Invalid project document result." },
        { status: 400 },
      );
    }
    const broker = yield* LatticeProjectDocumentBroker;
    const accepted = yield* broker.complete(workspaceRoot, body.body.id, body.body.result);
    return HttpServerResponse.jsonUnsafe({ accepted }, { status: accepted ? 200 : 409 });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

export const latticeProjectDocumentRouteLayer = Layer.mergeAll(pollRoute, resultRoute);

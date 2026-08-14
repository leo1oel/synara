import { Buffer } from "node:buffer";

import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { AuthError, ServerAuth } from "../auth/Services/ServerAuth.ts";
import { authErrorResponse, makeEffectAuthRequest } from "../auth/effectHttp.ts";
import {
  LatticeSpreadsheetBroker,
  type LatticeSpreadsheetResult,
} from "./Services/LatticeSpreadsheetBroker.ts";
import { readMcpJsonBody } from "./httpRoute.ts";

export const LATTICE_SPREADSHEET_POLL_PATH = "/api/lattice/spreadsheet-tools/poll";
export const LATTICE_SPREADSHEET_RESULT_PATH = "/api/lattice/spreadsheet-tools/result";
export const LATTICE_SPREADSHEET_MAX_BODY_BYTES = 512 * 1024;
export const LATTICE_SPREADSHEET_MAX_RESULT_BYTES = 384 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlyArray<string>): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isBoundedJson(value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value);
    return (
      serialized !== undefined &&
      Buffer.byteLength(serialized, "utf8") <= LATTICE_SPREADSHEET_MAX_RESULT_BYTES
    );
  } catch {
    return false;
  }
}

export function isLatticeSpreadsheetResultBody(
  value: unknown,
): value is { id: string; result: LatticeSpreadsheetResult } {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "result"])) return false;
  if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 128) return false;
  if (!isRecord(value.result) || !hasOnlyKeys(value.result, ["ok", "result", "error"])) {
    return false;
  }
  const result = value.result;
  if (typeof result.ok !== "boolean") return false;
  if (result.ok) {
    if (result.error !== undefined) return false;
    return result.result === undefined || isBoundedJson(result.result);
  }
  if (result.result !== undefined || !isRecord(result.error)) return false;
  if (!hasOnlyKeys(result.error, ["code", "message"])) return false;
  return (
    typeof result.error.code === "string" &&
    result.error.code.length > 0 &&
    result.error.code.length <= 128 &&
    typeof result.error.message === "string" &&
    result.error.message.length > 0 &&
    result.error.message.length <= 2_000
  );
}

const authenticate = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const auth = yield* ServerAuth;
  const session = yield* auth.authenticateHttpRequest(makeEffectAuthRequest(request));
  if (session.credentialSource !== "bearer") {
    return yield* new AuthError({ message: "Bearer authentication is required.", status: 403 });
  }
});

function workspaceRootFromRequest(request: HttpServerRequest.HttpServerRequest): string | null {
  const value = HttpServerRequest.toURL(request)?.searchParams.get("workspaceRoot")?.trim();
  return value && value.length <= 4_096 ? value : null;
}

const pollRoute = HttpRouter.add(
  "GET",
  LATTICE_SPREADSHEET_POLL_PATH,
  Effect.gen(function* () {
    yield* authenticate;
    const httpRequest = yield* HttpServerRequest.HttpServerRequest;
    const workspaceRoot = workspaceRootFromRequest(httpRequest);
    if (!workspaceRoot) return HttpServerResponse.text("Missing workspaceRoot", { status: 400 });
    const broker = yield* LatticeSpreadsheetBroker;
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
  LATTICE_SPREADSHEET_RESULT_PATH,
  Effect.gen(function* () {
    yield* authenticate;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const workspaceRoot = workspaceRootFromRequest(request);
    if (!workspaceRoot) return HttpServerResponse.text("Missing workspaceRoot", { status: 400 });
    const body = yield* readMcpJsonBody(request, LATTICE_SPREADSHEET_MAX_BODY_BYTES);
    if (body.kind === "too-large") {
      return HttpServerResponse.text("Payload Too Large", { status: 413 });
    }
    if (body.kind !== "ok" || !isLatticeSpreadsheetResultBody(body.body)) {
      return HttpServerResponse.jsonUnsafe(
        { error: "Invalid spreadsheet result." },
        { status: 400 },
      );
    }
    const broker = yield* LatticeSpreadsheetBroker;
    const accepted = yield* broker.complete(workspaceRoot, body.body.id, body.body.result);
    return HttpServerResponse.jsonUnsafe({ accepted }, { status: accepted ? 200 : 409 });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

export const latticeSpreadsheetRouteLayer = Layer.mergeAll(pollRoute, resultRoute);

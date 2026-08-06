import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { AuthError, ServerAuth } from "../auth/Services/ServerAuth.ts";
import { makeEffectAuthRequest } from "../auth/effectHttp.ts";
import { LatticeCanvasBroker, type LatticeCanvasResult } from "./Services/LatticeCanvasBroker.ts";
import { readMcpJsonBody } from "./httpRoute.ts";

export const LATTICE_CANVAS_POLL_PATH = "/api/lattice/canvas-tools/poll";
export const LATTICE_CANVAS_RESULT_PATH = "/api/lattice/canvas-tools/result";
export const LATTICE_CANVAS_MAX_BODY_BYTES = 512 * 1024;

function isResultBody(value: unknown): value is { id: string; result: LatticeCanvasResult } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.id !== "string" || body.id.length === 0 || body.id.length > 128) return false;
  if (!body.result || typeof body.result !== "object" || Array.isArray(body.result)) return false;
  const result = body.result as Record<string, unknown>;
  if (typeof result.ok !== "boolean") return false;
  if (!result.ok) {
    const error = result.error;
    if (!error || typeof error !== "object" || Array.isArray(error)) return false;
    const record = error as Record<string, unknown>;
    if (typeof record.code !== "string" || typeof record.message !== "string") return false;
  }
  return true;
}

const authenticate = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const auth = yield* ServerAuth;
  const session = yield* auth.authenticateHttpRequest(makeEffectAuthRequest(request));
  if (session.credentialSource !== "bearer") {
    return yield* new AuthError({ message: "Bearer authentication is required.", status: 403 });
  }
  return session;
});

function workspaceRootFromRequest(request: HttpServerRequest.HttpServerRequest): string | null {
  const value = HttpServerRequest.toURL(request)?.searchParams.get("workspaceRoot")?.trim();
  return value && value.length <= 4_096 ? value : null;
}

export const latticeCanvasRouteLayer = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    LATTICE_CANVAS_POLL_PATH,
    Effect.gen(function* () {
      yield* authenticate;
      const httpRequest = yield* HttpServerRequest.HttpServerRequest;
      const workspaceRoot = workspaceRootFromRequest(httpRequest);
      if (!workspaceRoot) return HttpServerResponse.text("Missing workspaceRoot", { status: 400 });
      const broker = yield* LatticeCanvasBroker;
      const request = yield* broker.poll(workspaceRoot);
      return request
        ? HttpServerResponse.jsonUnsafe(request, { status: 200, headers: { "Cache-Control": "no-store" } })
        : HttpServerResponse.empty({ status: 204, headers: { "Cache-Control": "no-store" } });
    }),
  ),
  HttpRouter.add(
    "POST",
    LATTICE_CANVAS_RESULT_PATH,
    Effect.gen(function* () {
      yield* authenticate;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const workspaceRoot = workspaceRootFromRequest(request);
      if (!workspaceRoot) return HttpServerResponse.text("Missing workspaceRoot", { status: 400 });
      const body = yield* readMcpJsonBody(request, LATTICE_CANVAS_MAX_BODY_BYTES);
      if (body.kind === "too-large") return HttpServerResponse.text("Payload Too Large", { status: 413 });
      if (body.kind !== "ok" || !isResultBody(body.body)) {
        return HttpServerResponse.jsonUnsafe({ error: "Invalid canvas result." }, { status: 400 });
      }
      const broker = yield* LatticeCanvasBroker;
      const accepted = yield* broker.complete(workspaceRoot, body.body.id, body.body.result);
      return HttpServerResponse.jsonUnsafe({ accepted }, { status: accepted ? 200 : 409 });
    }),
  ),
);

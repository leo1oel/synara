import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { AuthError, ServerAuth } from "../auth/Services/ServerAuth.ts";
import { authErrorResponse, makeEffectAuthRequest } from "../auth/effectHttp.ts";
import { parseLatticeAgentCompileResult } from "./agentQualityTrace.ts";
import { readMcpJsonBody } from "./httpRoute.ts";
import { AgentQualityTrace } from "./Services/AgentQualityTrace.ts";

export const LATTICE_AGENT_COMPILE_RESULT_PATH = "/api/lattice/agent-quality/compile-result";
export const LATTICE_AGENT_COMPILE_RESULT_MAX_BODY_BYTES = 4 * 1024;

const authenticate = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const auth = yield* ServerAuth;
  const session = yield* auth.authenticateHttpRequest(makeEffectAuthRequest(request));
  if (session.credentialSource !== "bearer") {
    return yield* new AuthError({ message: "Bearer authentication is required.", status: 403 });
  }
});

export const latticeAgentQualityRouteLayer = HttpRouter.add(
  "POST",
  LATTICE_AGENT_COMPILE_RESULT_PATH,
  Effect.gen(function* () {
    yield* authenticate;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* readMcpJsonBody(request, LATTICE_AGENT_COMPILE_RESULT_MAX_BODY_BYTES);
    if (body.kind === "too-large") {
      return HttpServerResponse.text("Payload Too Large", { status: 413 });
    }
    const result = body.kind === "ok" ? parseLatticeAgentCompileResult(body.body) : null;
    if (!result) {
      return HttpServerResponse.jsonUnsafe({ error: "Invalid compile result." }, { status: 400 });
    }
    const qualityTrace = yield* AgentQualityTrace;
    yield* qualityTrace.recordCompile(result);
    return HttpServerResponse.empty({ status: 204, headers: { "Cache-Control": "no-store" } });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

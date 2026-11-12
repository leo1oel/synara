import { Effect } from "effect";
import { HttpServerRequest } from "effect/unstable/http";

import { AuthError, ServerAuth } from "../auth/Services/ServerAuth.ts";
import { makeEffectAuthRequest } from "../auth/effectHttp.ts";
import { ServerConfig } from "../config.ts";
import { isLoopbackHost } from "../startupAccess.ts";

const BEARER_PREFIX = "Bearer ";

/**
 * Embedded Lattice relays receive the desktop startup token from their host.
 * Preserve the WebSocket bridge's loopback-only compatibility path while
 * requiring normal bearer sessions for every remotely reachable deployment.
 */
export const authenticateLatticeRelayRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const config = yield* ServerConfig;
  const authorization = request.headers.authorization;
  const bearer = authorization?.startsWith(BEARER_PREFIX)
    ? authorization.slice(BEARER_PREFIX.length).trim()
    : "";

  if (
    bearer.length > 0 &&
    isLoopbackHost(config.host) &&
    !config.publicUrl &&
    bearer === config.authToken
  ) {
    return;
  }

  const auth = yield* ServerAuth;
  const session = yield* auth.authenticateHttpRequest(makeEffectAuthRequest(request));
  if (session.credentialSource !== "bearer") {
    return yield* new AuthError({
      message: "Bearer authentication is required.",
      status: 403,
    });
  }
});

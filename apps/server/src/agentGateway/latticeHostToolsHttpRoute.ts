import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { authErrorResponse } from "../auth/effectHttp.ts";
import { LatticeHostToolQueue } from "./Services/LatticeHostToolQueue.ts";
import { authenticateLatticeRelayRequest } from "./latticeRelayAuthentication.ts";

// The one long poll the embedded agent panel holds for every Lattice host
// tool; each tool's result still returns through that tool's own route.
export const LATTICE_HOST_TOOLS_POLL_PATH = "/api/lattice/host-tools/poll";

function workspaceRootFromRequest(request: HttpServerRequest.HttpServerRequest): string | null {
  const value = HttpServerRequest.toURL(request)?.searchParams.get("workspaceRoot")?.trim();
  return value && value.length <= 4_096 ? value : null;
}

export const latticeHostToolsRouteLayer = HttpRouter.add(
  "GET",
  LATTICE_HOST_TOOLS_POLL_PATH,
  Effect.gen(function* () {
    yield* authenticateLatticeRelayRequest;
    const workspaceRoot = workspaceRootFromRequest(yield* HttpServerRequest.HttpServerRequest);
    if (!workspaceRoot) return HttpServerResponse.text("Missing workspaceRoot", { status: 400 });
    const delivery = yield* (yield* LatticeHostToolQueue).poll(workspaceRoot);
    return delivery
      ? HttpServerResponse.jsonUnsafe(delivery, {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        })
      : HttpServerResponse.empty({ status: 204, headers: { "Cache-Control": "no-store" } });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

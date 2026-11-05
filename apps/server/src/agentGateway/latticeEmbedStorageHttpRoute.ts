import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { authErrorResponse } from "../auth/effectHttp.ts";
import { ServerConfig } from "../config.ts";
import { readMcpJsonBody } from "./httpRoute.ts";
import {
  LATTICE_EMBED_STORAGE_MAX_BYTES,
  latticeEmbedStoreFor,
  parseLatticeEmbedStorageUpdate,
} from "./latticeEmbedStorage.ts";
import { authenticateLatticeRelayRequest } from "./latticeRelayAuthentication.ts";

/** GET answers the stored snapshot; POST applies one mirror pass. See latticeEmbedStorage.ts. */
export const LATTICE_EMBED_STORAGE_PATH = "/api/lattice/embed-storage";
// A first pass carries every key at once; JSON escaping can add to the stored bytes.
const LATTICE_EMBED_STORAGE_MAX_BODY_BYTES = LATTICE_EMBED_STORAGE_MAX_BYTES * 2;

const NO_STORE = { "Cache-Control": "no-store" };

const readSnapshot = HttpRouter.add(
  "GET",
  LATTICE_EMBED_STORAGE_PATH,
  Effect.gen(function* () {
    yield* authenticateLatticeRelayRequest;
    const config = yield* ServerConfig;
    const snapshot = yield* Effect.promise(() => latticeEmbedStoreFor(config.stateDir).snapshot());
    return HttpServerResponse.jsonUnsafe(snapshot, { status: 200, headers: NO_STORE });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

const applyUpdate = HttpRouter.add(
  "POST",
  LATTICE_EMBED_STORAGE_PATH,
  Effect.gen(function* () {
    yield* authenticateLatticeRelayRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* readMcpJsonBody(request, LATTICE_EMBED_STORAGE_MAX_BODY_BYTES);
    if (body.kind === "too-large") {
      return HttpServerResponse.text("Payload Too Large", { status: 413 });
    }
    const update = body.kind === "ok" ? parseLatticeEmbedStorageUpdate(body.body) : null;
    if (!update) {
      return HttpServerResponse.jsonUnsafe({ error: "Invalid storage update." }, { status: 400 });
    }
    const config = yield* ServerConfig;
    const result = yield* Effect.tryPromise(() =>
      latticeEmbedStoreFor(config.stateDir).apply(update),
    ).pipe(Effect.catch(() => Effect.succeed("failed" as const)));
    if (result === "too-large") {
      return HttpServerResponse.text("Payload Too Large", { status: 413 });
    }
    if (result === "failed") {
      return HttpServerResponse.jsonUnsafe(
        { error: "Storage could not be written." },
        { status: 500 },
      );
    }
    return HttpServerResponse.empty({ status: 204, headers: NO_STORE });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

export const latticeEmbedStorageRouteLayer = Layer.mergeAll(readSnapshot, applyUpdate);

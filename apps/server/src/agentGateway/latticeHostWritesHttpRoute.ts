import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { authErrorResponse } from "../auth/effectHttp.ts";
import { CheckpointStore } from "../checkpointing/Services/CheckpointStore.ts";
import {
  checkpointRefForThreadTurnHostWrites,
  resolveThreadWorkspaceCwd,
} from "../checkpointing/Utils.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { readMcpJsonBody } from "./httpRoute.ts";
import { attributeHostWrites, parseLatticeHostFileWrites } from "./latticeHostWrites.ts";
import { authenticateLatticeRelayRequest } from "./latticeRelayAuthentication.ts";

export const LATTICE_HOST_FILE_WRITES_PATH = "/api/lattice/host-file-writes";
export const LATTICE_HOST_FILE_WRITES_MAX_BODY_BYTES = 512 * 1024;

const canonical = (value: string) =>
  Effect.tryPromise(() => realpath(value)).pipe(Effect.catch(() => Effect.succeed(resolve(value))));

export const latticeHostWritesRouteLayer = HttpRouter.add(
  "POST",
  LATTICE_HOST_FILE_WRITES_PATH,
  Effect.gen(function* () {
    yield* authenticateLatticeRelayRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* readMcpJsonBody(request, LATTICE_HOST_FILE_WRITES_MAX_BODY_BYTES);
    if (body.kind === "too-large") {
      return HttpServerResponse.text("Payload Too Large", { status: 413 });
    }
    const report = body.kind === "ok" ? parseLatticeHostFileWrites(body.body) : null;
    if (!report) {
      return HttpServerResponse.jsonUnsafe({ error: "Invalid host file writes." }, { status: 400 });
    }
    const engine = yield* OrchestrationEngineService;
    const checkpointStore = yield* CheckpointStore;
    const readModel = yield* engine.getReadModel();
    const root = yield* canonical(report.workspaceRoot);
    // Only threads with a turn can own a write; resolve just their folders.
    const canonicalCwds = new Map<string, string>();
    for (const thread of readModel.threads) {
      if (!thread.latestTurn || thread.deletedAt) continue;
      const cwd = resolveThreadWorkspaceCwd({ thread, projects: readModel.projects });
      if (cwd && !canonicalCwds.has(cwd)) canonicalCwds.set(cwd, yield* canonical(cwd));
    }
    const attributions = attributeHostWrites({
      report,
      threads: readModel.threads,
      projects: readModel.projects,
      sameWorkspace: (cwd) => cwd === report.workspaceRoot || canonicalCwds.get(cwd) === root,
    });
    // Recording is the fail-closed half of Undo: a lost report lets Undo delete
    // the edit. Report a failure so the host can retry rather than answer 204.
    const failures: string[] = [];
    for (const attribution of attributions) {
      yield* checkpointStore
        .recordHostWrites({
          cwd: attribution.cwd,
          ref: checkpointRefForThreadTurnHostWrites(attribution.threadId, attribution.turnId),
          paths: attribution.paths,
        })
        .pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              failures.push(error.message);
            }),
          ),
        );
    }
    if (failures.length > 0) {
      return HttpServerResponse.jsonUnsafe(
        { error: `Could not record host file writes: ${failures.join("; ")}` },
        { status: 500 },
      );
    }
    return HttpServerResponse.empty({ status: 204, headers: { "Cache-Control": "no-store" } });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

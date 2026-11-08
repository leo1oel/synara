import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ThreadId, TurnId } from "@synara/contracts";
import { Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import { AuthError, ServerAuth, type ServerAuthShape } from "../auth/Services/ServerAuth.ts";
import {
  CheckpointStore,
  type CheckpointStoreShape,
} from "../checkpointing/Services/CheckpointStore.ts";
import { checkpointRefForThreadTurnHostWrites } from "../checkpointing/Utils.ts";
import { ServerConfig, type ServerConfigShape } from "../config.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine.ts";
import { LATTICE_HOST_FILE_WRITES } from "./latticeHostWrites.ts";
import {
  LATTICE_HOST_FILE_WRITES_PATH,
  latticeHostWritesRouteLayer,
} from "./latticeHostWritesHttpRoute.ts";

describe("latticeHostWritesRouteLayer", () => {
  it("records a reported write on the turn running in that workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "synara-host-writes-route-"));
    const scope = await Effect.runPromise(Scope.make("sequential"));
    const recorded: unknown[] = [];
    let nodeServer: http.Server | null = null;
    const requestedAt = new Date(Date.now() - 60_000).toISOString();
    const readModel = {
      projects: [{ id: ProjectId.makeUnsafe("p1"), kind: "project", workspaceRoot: root }],
      threads: [
        {
          id: ThreadId.makeUnsafe("t1"),
          projectId: ProjectId.makeUnsafe("p1"),
          worktreePath: null,
          deletedAt: null,
          latestTurn: { turnId: TurnId.makeUnsafe("turn-1"), requestedAt, completedAt: null },
        },
      ],
    };
    const auth = {
      authenticateHttpRequest: (request: { headers: Record<string, string | undefined> }) =>
        request.headers.authorization === "Bearer valid-token"
          ? Effect.succeed({
              sessionId: "s",
              subject: "t",
              method: "bearer",
              role: "owner",
              credentialSource: "bearer",
            } as never)
          : Effect.fail(new AuthError({ message: "Unauthorized", status: 401 })),
    } as unknown as ServerAuthShape;
    const store = {
      recordHostWrites: (input) => Effect.sync(() => void recorded.push(input)),
    } as Partial<CheckpointStoreShape> as CheckpointStoreShape;
    const engine = {
      getReadModel: () => Effect.succeed(readModel),
    } as unknown as OrchestrationEngineShape;
    try {
      await Effect.runPromise(
        Scope.provide(
          Effect.gen(function* () {
            const httpServer = yield* NodeHttpServer.make(
              () => {
                nodeServer = http.createServer();
                return nodeServer;
              },
              { port: 0, host: "127.0.0.1" },
            );
            yield* httpServer.serve(yield* HttpRouter.toHttpEffect(latticeHostWritesRouteLayer));
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                Layer.succeed(ServerConfig, {
                  host: "127.0.0.1",
                  authToken: "desktop-token",
                } as ServerConfigShape),
                Layer.succeed(ServerAuth, auth),
                Layer.succeed(CheckpointStore, store),
                Layer.succeed(OrchestrationEngineService, engine),
                NodeServices.layer,
              ),
            ),
          ),
          scope,
        ),
      );
      const address = (nodeServer as http.Server | null)?.address();
      if (!address || typeof address !== "object") throw new Error("Missing test server address");
      const post = (body: unknown, token = "valid-token") =>
        fetch(`http://127.0.0.1:${address.port}${LATTICE_HOST_FILE_WRITES_PATH}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      const report = {
        type: LATTICE_HOST_FILE_WRITES,
        version: 1,
        workspaceRoot: root,
        writes: [{ path: "main.tex", writtenAt: new Date().toISOString() }],
      };

      expect((await post(report, "wrong")).status).toBe(401);
      expect((await post({ ...report, writes: [{ path: "../x", writtenAt: "" }] })).status).toBe(
        400,
      );
      expect((await post(report)).status).toBe(204);
      expect(recorded).toEqual([
        {
          cwd: root,
          ref: checkpointRefForThreadTurnHostWrites(
            ThreadId.makeUnsafe("t1"),
            TurnId.makeUnsafe("turn-1"),
          ),
          paths: ["main.tex"],
        },
      ]);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      rmSync(root, { recursive: true, force: true });
    }
  });
});

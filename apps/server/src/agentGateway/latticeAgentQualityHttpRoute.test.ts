import http from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import { AuthError, ServerAuth, type ServerAuthShape } from "../auth/Services/ServerAuth.ts";
import { LATTICE_AGENT_COMPILE_RESULT } from "./agentQualityTrace.ts";
import {
  LATTICE_AGENT_COMPILE_RESULT_PATH,
  latticeAgentQualityRouteLayer,
} from "./latticeAgentQualityHttpRoute.ts";
import { AgentQualityTrace, type AgentQualityTraceShape } from "./Services/AgentQualityTrace.ts";

async function withQualityServer(
  run: (input: { readonly origin: string; readonly recorded: unknown[] }) => Promise<void>,
) {
  const scope = await Effect.runPromise(Scope.make("sequential"));
  const recorded: unknown[] = [];
  let nodeServer: http.Server | null = null;
  const auth = {
    authenticateHttpRequest: (request: { headers: Record<string, string | undefined> }) =>
      request.headers.authorization === "Bearer valid-token"
        ? Effect.succeed({
            sessionId: "session-1",
            subject: "test",
            method: "bearer",
            role: "owner",
            credentialSource: "bearer",
          } as never)
        : Effect.fail(new AuthError({ message: "Unauthorized", status: 401 })),
  } as unknown as ServerAuthShape;
  const qualityTrace: AgentQualityTraceShape = {
    start: Effect.void,
    prepareTurnContext: () => Effect.void,
    failTurnContext: () => Effect.void,
    recordCompile: (result) =>
      Effect.sync(() => {
        recorded.push(result);
      }),
  };

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
          const app = yield* HttpRouter.toHttpEffect(latticeAgentQualityRouteLayer);
          yield* httpServer.serve(app);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(ServerAuth, auth),
              Layer.succeed(AgentQualityTrace, qualityTrace),
              NodeServices.layer,
            ),
          ),
        ),
        scope,
      ),
    );
    const address = (nodeServer as http.Server | null)?.address();
    if (!address || typeof address !== "object") throw new Error("Missing test server address");
    await run({ origin: `http://127.0.0.1:${address.port}`, recorded });
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}

describe("latticeAgentQualityRouteLayer", () => {
  it("requires bearer authentication and rejects content-bearing compile payloads", async () => {
    await withQualityServer(async ({ origin, recorded }) => {
      const valid = {
        type: LATTICE_AGENT_COMPILE_RESULT,
        version: 1,
        threadId: "thread-1",
        turnId: "turn-1",
        checkpointRef: "refs/synara/checkpoints/1",
        compiledAt: "2026-08-14T10:00:00.000Z",
        success: true,
        durationMs: 100,
        rootDocument: "main.tex",
        diagnostics: { errors: 0, warnings: 0 },
      };
      const unauthorized = await fetch(`${origin}${LATTICE_AGENT_COMPILE_RESULT_PATH}`, {
        method: "POST",
        body: JSON.stringify(valid),
      });
      expect(unauthorized.status).toBe(401);

      const contentBearing = await fetch(`${origin}${LATTICE_AGENT_COMPILE_RESULT_PATH}`, {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...valid, buildLog: "private paper text" }),
      });
      expect(contentBearing.status).toBe(400);

      const accepted = await fetch(`${origin}${LATTICE_AGENT_COMPILE_RESULT_PATH}`, {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(valid),
      });
      expect(accepted.status).toBe(204);
      expect(recorded).toEqual([valid]);
    });
  });
});

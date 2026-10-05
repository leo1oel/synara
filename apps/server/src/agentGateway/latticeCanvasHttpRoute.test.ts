import http from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import { AuthError, ServerAuth, type ServerAuthShape } from "../auth/Services/ServerAuth.ts";
import { ServerConfig, type ServerConfigShape } from "../config.ts";
import {
  LatticeCanvasBroker,
  type LatticeCanvasBrokerShape,
  type LatticeCanvasResult,
} from "./Services/LatticeCanvasBroker.ts";
import {
  LATTICE_CANVAS_POLL_PATH,
  LATTICE_CANVAS_RESULT_PATH,
  latticeCanvasRouteLayer,
} from "./latticeCanvasHttpRoute.ts";

interface CompletedResult {
  readonly workspaceRoot: string;
  readonly id: string;
  readonly result: LatticeCanvasResult;
}

async function withCanvasServer(
  run: (input: {
    readonly origin: string;
    readonly completed: ReadonlyArray<CompletedResult>;
  }) => Promise<void>,
  configOverrides: Partial<ServerConfigShape> = {},
): Promise<void> {
  const scope = await Effect.runPromise(Scope.make("sequential"));
  const completed: CompletedResult[] = [];
  let nodeServer: http.Server | null = null;
  const config = {
    host: "127.0.0.1",
    publicUrl: undefined,
    authToken: "desktop-token",
    ...configOverrides,
  } as ServerConfigShape;
  const auth = {
    authenticateHttpRequest: () =>
      Effect.fail(new AuthError({ message: "Authentication required.", status: 401 })),
  } as unknown as ServerAuthShape;
  const broker: LatticeCanvasBrokerShape = {
    invoke: () => Effect.die("invoke is not used by relay route tests"),
    poll: (workspaceRoot) =>
      Effect.succeed(
        workspaceRoot === "/workspace/project"
          ? {
              id: "canvas-request",
              action: "list",
              args: { limit: 3 },
              expiresAt: Date.now() + 1_000,
            }
          : null,
      ),
    complete: (workspaceRoot, id, result) =>
      Effect.sync(() => {
        completed.push({ workspaceRoot, id, result });
        return id === "canvas-request";
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
          yield* httpServer.serve(yield* HttpRouter.toHttpEffect(latticeCanvasRouteLayer));
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(ServerConfig, config),
              Layer.succeed(ServerAuth, auth),
              Layer.succeed(LatticeCanvasBroker, broker),
              NodeServices.layer,
            ),
          ),
        ),
        scope,
      ),
    );
    const address = (nodeServer as http.Server | null)?.address();
    if (!address || typeof address !== "object") throw new Error("Expected server address");
    await run({ origin: `http://127.0.0.1:${String(address.port)}`, completed });
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}

function routeUrl(origin: string, path: string) {
  return `${origin}${path}?${new URLSearchParams({ workspaceRoot: "/workspace/project" })}`;
}

describe("latticeCanvasRouteLayer", () => {
  it("returns auth errors and accepts the loopback desktop relay token", async () => {
    await withCanvasServer(async ({ origin }) => {
      const pollUrl = routeUrl(origin, LATTICE_CANVAS_POLL_PATH);
      expect((await fetch(pollUrl)).status).toBe(401);

      const poll = await fetch(pollUrl, {
        headers: { Authorization: "Bearer desktop-token" },
      });
      expect(poll.status).toBe(200);
      expect(await poll.json()).toMatchObject({
        id: "canvas-request",
        action: "list",
        args: { limit: 3 },
      });
    });
  });

  it("does not accept the desktop relay token for a publicly reachable server", async () => {
    await withCanvasServer(
      async ({ origin }) => {
        const response = await fetch(routeUrl(origin, LATTICE_CANVAS_POLL_PATH), {
          headers: { Authorization: "Bearer desktop-token" },
        });
        expect(response.status).toBe(401);
      },
      { publicUrl: new URL("https://synara.example.test/") },
    );
  });

  it("submits host results with the desktop relay token", async () => {
    await withCanvasServer(async ({ origin, completed }) => {
      const response = await fetch(routeUrl(origin, LATTICE_CANVAS_RESULT_PATH), {
        method: "POST",
        headers: {
          Authorization: "Bearer desktop-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: "canvas-request",
          result: { ok: false, error: { code: "canvas_not_open", message: "Not open." } },
        }),
      });

      expect(response.status).toBe(200);
      expect(completed).toEqual([
        {
          workspaceRoot: "/workspace/project",
          id: "canvas-request",
          result: { ok: false, error: { code: "canvas_not_open", message: "Not open." } },
        },
      ]);
    });
  });
});

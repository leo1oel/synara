import http from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import {
  AuthError,
  ServerAuth,
  type AuthRequest,
  type ServerAuthShape,
} from "../auth/Services/ServerAuth.ts";
import {
  LatticeSpreadsheetBroker,
  type LatticeSpreadsheetBrokerShape,
  type LatticeSpreadsheetResult,
} from "./Services/LatticeSpreadsheetBroker.ts";
import {
  LATTICE_SPREADSHEET_MAX_BODY_BYTES,
  LATTICE_SPREADSHEET_POLL_PATH,
  LATTICE_SPREADSHEET_RESULT_PATH,
  latticeSpreadsheetRouteLayer,
} from "./latticeSpreadsheetHttpRoute.ts";

interface CompletedResult {
  readonly workspaceRoot: string;
  readonly id: string;
  readonly result: LatticeSpreadsheetResult;
}

async function withSpreadsheetServer(
  run: (input: {
    readonly origin: string;
    readonly completed: ReadonlyArray<CompletedResult>;
  }) => Promise<void>,
): Promise<void> {
  const scope = await Effect.runPromise(Scope.make("sequential"));
  const completed: CompletedResult[] = [];
  let nodeServer: http.Server | null = null;
  const auth = {
    authenticateHttpRequest: (request: AuthRequest) => {
      if (request.headers.authorization === "Bearer bearer-token") {
        return Effect.succeed({
          sessionId: "session" as never,
          subject: "owner",
          method: "bearer-session-token" as const,
          role: "owner" as const,
          credentialSource: "bearer" as const,
        });
      }
      if (request.cookies.synara_session === "cookie-token") {
        return Effect.succeed({
          sessionId: "session" as never,
          subject: "owner",
          method: "browser-session-cookie" as const,
          role: "owner" as const,
          credentialSource: "cookie" as const,
        });
      }
      return Effect.fail(new AuthError({ message: "Authentication required.", status: 401 }));
    },
  } as unknown as ServerAuthShape;
  const broker: LatticeSpreadsheetBrokerShape = {
    invoke: () => Effect.die("invoke is not used by relay route tests"),
    poll: (workspaceRoot) =>
      Effect.succeed(
        workspaceRoot === "/workspace/project"
          ? {
              id: "spreadsheet-request",
              action: "read",
              args: { path: "data.lattice-sheet", range: "A1" },
              expiresAt: Date.now() + 1_000,
            }
          : null,
      ),
    complete: (workspaceRoot, id, result) =>
      Effect.sync(() => {
        completed.push({ workspaceRoot, id, result });
        return id === "spreadsheet-request";
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
          yield* httpServer.serve(yield* HttpRouter.toHttpEffect(latticeSpreadsheetRouteLayer));
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(ServerAuth, auth),
              Layer.succeed(LatticeSpreadsheetBroker, broker),
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

function routeUrl(origin: string, path: string, workspaceRoot = "/workspace/project") {
  return `${origin}${path}?${new URLSearchParams({ workspaceRoot })}`;
}

describe("latticeSpreadsheetRouteLayer", () => {
  it("requires bearer authentication and returns only the requested workspace queue", async () => {
    await withSpreadsheetServer(async ({ origin }) => {
      const pollUrl = routeUrl(origin, LATTICE_SPREADSHEET_POLL_PATH);
      expect((await fetch(pollUrl)).status).toBe(401);
      expect(
        (
          await fetch(pollUrl, {
            headers: { Cookie: "synara_session=cookie-token" },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${origin}${LATTICE_SPREADSHEET_POLL_PATH}`, {
            headers: { Authorization: "Bearer bearer-token" },
          })
        ).status,
      ).toBe(400);

      const poll = await fetch(pollUrl, {
        headers: { Authorization: "Bearer bearer-token" },
      });
      expect(poll.status).toBe(200);
      expect(poll.headers.get("cache-control")).toBe("no-store");
      expect(await poll.json()).toMatchObject({
        id: "spreadsheet-request",
        action: "read",
        args: { path: "data.lattice-sheet", range: "A1" },
      });

      const otherWorkspace = await fetch(
        routeUrl(origin, LATTICE_SPREADSHEET_POLL_PATH, "/workspace/other"),
        { headers: { Authorization: "Bearer bearer-token" } },
      );
      expect(otherWorkspace.status).toBe(204);
    });
  });

  it("bounds and strictly validates result envelopes before completing a request", async () => {
    await withSpreadsheetServer(async ({ origin, completed }) => {
      const resultUrl = routeUrl(origin, LATTICE_SPREADSHEET_RESULT_PATH);
      const post = (body: unknown, authorization = "Bearer bearer-token") =>
        fetch(resultUrl, {
          method: "POST",
          headers: { Authorization: authorization, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

      const oversized = await post({ value: "x".repeat(LATTICE_SPREADSHEET_MAX_BODY_BYTES) });
      expect(oversized.status).toBe(413);
      expect(completed).toHaveLength(0);

      const invalidBodies = [
        { id: "spreadsheet-request", result: { ok: false } },
        {
          id: "spreadsheet-request",
          result: { ok: true, error: { code: "bad", message: "contradictory" } },
        },
        {
          id: "spreadsheet-request",
          result: { ok: false, result: {}, error: { code: "bad", message: "bad" } },
        },
        {
          id: "spreadsheet-request",
          result: { ok: false, error: { code: "bad", message: "bad", details: {} } },
        },
        { id: "spreadsheet-request", result: { ok: true }, unexpected: true },
      ];
      for (const body of invalidBodies) expect((await post(body)).status).toBe(400);
      expect(completed).toHaveLength(0);

      const valid = await post({
        id: "spreadsheet-request",
        result: { ok: true, result: { range: "A1", values: [[42]] } },
      });
      expect(valid.status).toBe(200);
      expect(await valid.json()).toEqual({ accepted: true });
      expect(completed).toEqual([
        {
          workspaceRoot: "/workspace/project",
          id: "spreadsheet-request",
          result: { ok: true, result: { range: "A1", values: [[42]] } },
        },
      ]);
    });
  });
});

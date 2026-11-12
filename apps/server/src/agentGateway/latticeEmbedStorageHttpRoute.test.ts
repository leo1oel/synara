import * as fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterEach, describe, expect, it } from "vitest";

import { AuthError, ServerAuth, type ServerAuthShape } from "../auth/Services/ServerAuth.ts";
import { ServerConfig, type ServerConfigShape } from "../config.ts";
import { LATTICE_EMBED_STORAGE_FILE, makeLatticeEmbedStore } from "./latticeEmbedStorage.ts";
import {
  LATTICE_EMBED_STORAGE_PATH,
  latticeEmbedStorageRouteLayer,
} from "./latticeEmbedStorageHttpRoute.ts";

const stateDirs: string[] = [];

afterEach(async () => {
  await Promise.all(stateDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeStateDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-embed-storage-"));
  stateDirs.push(dir);
  return dir;
}

async function withStorageServer(stateDir: string, run: (origin: string) => Promise<void>) {
  const scope = await Effect.runPromise(Scope.make("sequential"));
  let nodeServer: http.Server | null = null;
  const config = {
    host: "127.0.0.1",
    publicUrl: undefined,
    authToken: "desktop-token",
    stateDir,
  } as ServerConfigShape;
  const auth = {
    authenticateHttpRequest: () =>
      Effect.fail(new AuthError({ message: "Unauthorized", status: 401 })),
  } as unknown as ServerAuthShape;

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
          const app = yield* HttpRouter.toHttpEffect(latticeEmbedStorageRouteLayer);
          yield* httpServer.serve(app);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(ServerConfig, config),
              Layer.succeed(ServerAuth, auth),
              NodeServices.layer,
            ),
          ),
        ),
        scope,
      ),
    );
    const address = (nodeServer as http.Server | null)?.address();
    if (!address || typeof address !== "object") throw new Error("Missing test server address");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}

const authorized = {
  Authorization: "Bearer desktop-token",
  "Content-Type": "application/json",
};

function post(origin: string, body: unknown, headers: Record<string, string> = authorized) {
  return fetch(`${origin}${LATTICE_EMBED_STORAGE_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function readEntries(origin: string): Promise<Record<string, string>> {
  const response = await fetch(`${origin}${LATTICE_EMBED_STORAGE_PATH}`, { headers: authorized });
  expect(response.status).toBe(200);
  const snapshot = (await response.json()) as { version: number; entries: Record<string, string> };
  expect(snapshot.version).toBe(1);
  return snapshot.entries;
}

describe("latticeEmbedStorageRouteLayer", () => {
  it("requires the host token", async () => {
    await withStorageServer(await makeStateDir(), async (origin) => {
      expect((await fetch(`${origin}${LATTICE_EMBED_STORAGE_PATH}`)).status).toBe(401);
      const rejected = await post(
        origin,
        { version: 1, observedAt: 1, set: { "synara:x": "1" }, remove: [] },
        { "Content-Type": "application/json" },
      );
      expect(rejected.status).toBe(401);
    });
  });

  it("rejects keys outside Synara's namespace and malformed passes", async () => {
    await withStorageServer(await makeStateDir(), async (origin) => {
      for (const body of [
        { version: 1, observedAt: 1, set: { "lattice:x": "1" }, remove: [] },
        { version: 1, observedAt: 1, set: { "synara:x": 1 }, remove: [] },
        { version: 1, observedAt: 1, set: {}, remove: ["other"] },
        { version: 1, observedAt: 1, set: { "synara:x": "1" }, remove: ["synara:x"] },
        { version: 2, observedAt: 1, set: {}, remove: [] },
        { version: 1, observedAt: -1, set: {}, remove: [] },
        { version: 1, set: {}, remove: [] },
      ]) {
        expect((await post(origin, body)).status).toBe(400);
      }
      expect(await readEntries(origin)).toEqual({});
    });
  });

  it("keeps every mirrored key across a server restart", async () => {
    const stateDir = await makeStateDir();
    const settings = JSON.stringify({ defaultProvider: "codex", providerOrder: ["codex"] });
    const drafts = JSON.stringify({ state: { draftsByThreadId: { t1: { prompt: "draft" } } } });

    await withStorageServer(stateDir, async (origin) => {
      const first = await post(origin, {
        version: 1,
        observedAt: 100,
        set: {
          "synara:app-settings:v1": settings,
          "synara:composer-drafts:v1": drafts,
          "synara:theme": "dark",
        },
        remove: [],
      });
      expect(first.status).toBe(204);
      expect(
        (await post(origin, { version: 1, observedAt: 200, set: {}, remove: ["synara:theme"] }))
          .status,
      ).toBe(204);
    });

    const file = JSON.parse(
      await fs.readFile(path.join(stateDir, LATTICE_EMBED_STORAGE_FILE), "utf8"),
    ) as unknown;
    expect(file).toMatchObject({ version: 1 });
    expect((await fs.stat(path.join(stateDir, LATTICE_EMBED_STORAGE_FILE))).mode & 0o777).toBe(
      0o600,
    );

    // A fresh store over the same directory stands in for the next Lattice launch.
    const relaunched = makeLatticeEmbedStore(path.join(stateDir, LATTICE_EMBED_STORAGE_FILE));
    expect((await relaunched.snapshot()).entries).toEqual({
      "synara:app-settings:v1": settings,
      "synara:composer-drafts:v1": drafts,
    });
  });

  it("keeps the newest reading when sibling frames report out of order", async () => {
    const stateDir = await makeStateDir();
    const store = makeLatticeEmbedStore(path.join(stateDir, LATTICE_EMBED_STORAGE_FILE));

    await store.apply({ version: 1, observedAt: 300, set: { "synara:a": "new" }, remove: [] });
    await store.apply({ version: 1, observedAt: 200, set: { "synara:a": "old" }, remove: [] });
    await store.apply({ version: 1, observedAt: 400, set: {}, remove: ["synara:b"] });
    await store.apply({ version: 1, observedAt: 350, set: { "synara:b": "stale" }, remove: [] });

    expect((await store.snapshot()).entries).toEqual({ "synara:a": "new" });
  });
});

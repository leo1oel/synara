import { ThreadId } from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  diffLatticeEmbedStorage,
  LATTICE_EMBED_STORAGE_PATH,
  restoreLatticeEmbedStorageWith,
} from "./latticeEmbedStorage";

const ORIGINAL_LOCAL_STORAGE = globalThis.localStorage;
const ORIGIN = "http://127.0.0.1:3773";
const TOKEN = "embed-token";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
}

interface FakeServer {
  readonly entries: Map<string, string>;
  readonly posts: Array<{ set: Record<string, string>; remove: string[] }>;
  failNextPost: number | null;
  readonly fetch: typeof fetch;
}

/** The sidecar's route, reduced to what the page relies on. */
function createFakeServer(initial: Record<string, string> = {}): FakeServer {
  const server: FakeServer = {
    entries: new Map(Object.entries(initial)),
    posts: [],
    failNextPost: null,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`${ORIGIN}${LATTICE_EMBED_STORAGE_PATH}`);
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
      if (!init?.method || init.method === "GET") {
        return Response.json({
          version: 1,
          exportedAt: new Date().toISOString(),
          entries: Object.fromEntries(server.entries),
        });
      }
      if (server.failNextPost !== null) {
        const status = server.failNextPost;
        server.failNextPost = null;
        return new Response(null, { status });
      }
      const update = JSON.parse(String(init.body)) as {
        set: Record<string, string>;
        remove: string[];
      };
      server.posts.push(update);
      for (const [key, value] of Object.entries(update.set)) server.entries.set(key, value);
      for (const key of update.remove) server.entries.delete(key);
      return new Response(null, { status: 204 });
    }) as typeof fetch,
  };
  return server;
}

const stops: Array<() => void> = [];

async function launch(storage: Storage, server: FakeServer, now?: () => number) {
  const stop = await restoreLatticeEmbedStorageWith({
    storage,
    token: TOKEN,
    origin: ORIGIN,
    fetch: server.fetch,
    intervalMs: 5,
    ...(now ? { now } : {}),
  });
  if (stop) stops.push(stop);
  return stop;
}

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  globalThis.localStorage = ORIGINAL_LOCAL_STORAGE;
  vi.resetModules();
});

describe("latticeEmbedStorage", () => {
  it("brings composer drafts and the sticky model back after Lattice relaunches", async () => {
    const server = createFakeServer();
    const threadId = ThreadId.makeUnsafe("thread-embed-relaunch");

    // First launch: the stores write to this launch's partitioned storage.
    globalThis.localStorage = createMemoryStorage();
    vi.resetModules();
    const firstMirror = await import("./latticeEmbedStorage");
    expect(
      await firstMirror.restoreLatticeEmbedStorageWith({
        storage: globalThis.localStorage,
        token: TOKEN,
        origin: ORIGIN,
        fetch: server.fetch,
        intervalMs: 5,
      }),
    ).toBeTypeOf("function");
    const first = await import("./composerDraftStore");
    const { modelSelection } = await import("./composerDraftStoreTestFixtures");
    const sticky = modelSelection("codex", "gpt-5.6-sol", { reasoningEffort: "high" });
    first.useComposerDraftStore.getState().setStickyModelSelection(sticky);
    first.useComposerDraftStore.getState().setPrompt(threadId, "unsent draft");
    await vi.waitFor(
      () => {
        expect(server.entries.get(first.COMPOSER_DRAFT_STORAGE_KEY)).toContain("unsent draft");
      },
      { timeout: 2_000 },
    );

    // Relaunch: WebKit hands the frame empty storage; nothing else carries over.
    globalThis.localStorage = createMemoryStorage();
    vi.resetModules();
    const secondMirror = await import("./latticeEmbedStorage");
    const stop = await secondMirror.restoreLatticeEmbedStorageWith({
      storage: globalThis.localStorage,
      token: TOKEN,
      origin: ORIGIN,
      fetch: server.fetch,
      intervalMs: 5,
    });
    if (stop) stops.push(stop);
    const second = await import("./composerDraftStore");
    const state = second.useComposerDraftStore.getState();
    expect(state.stickyActiveProvider).toBe("codex");
    expect(state.stickyModelSelectionByProvider.codex).toEqual(sticky);
    expect(state.draftsByThreadId[threadId]?.prompt).toBe("unsent draft");
  });

  it("keeps values this session already wrote over the stored copy and reports them", async () => {
    const server = createFakeServer({
      "synara:app-settings:v1": '{"defaultProvider":"codex"}',
      "synara:theme": "dark",
    });
    const storage = createMemoryStorage();
    storage.setItem("synara:theme", "light");

    await launch(storage, server);

    expect(storage.getItem("synara:app-settings:v1")).toBe('{"defaultProvider":"codex"}');
    expect(storage.getItem("synara:theme")).toBe("light");
    await vi.waitFor(() => expect(server.entries.get("synara:theme")).toBe("light"));
  });

  it("mirrors changes and removals of Synara keys only", async () => {
    const server = createFakeServer({ "synara:old": "1" });
    const storage = createMemoryStorage();
    await launch(storage, server);

    storage.setItem("synara:app-settings:v1", '{"hiddenProviders":["cursor"]}');
    storage.setItem("unrelated", "x");
    storage.removeItem("synara:old");

    await vi.waitFor(() => {
      expect(Object.fromEntries(server.entries)).toEqual({
        "synara:app-settings:v1": '{"hiddenProviders":["cursor"]}',
      });
    });
    expect(server.posts.flatMap((post) => Object.keys(post.set))).not.toContain("unrelated");
  });

  it("resends a pass the server failed to write", async () => {
    const server = createFakeServer();
    const storage = createMemoryStorage();
    await launch(storage, server);

    server.failNextPost = 500;
    storage.setItem("synara:composer-drafts:v1", "draft");

    await vi.waitFor(() => expect(server.entries.get("synara:composer-drafts:v1")).toBe("draft"));
  });

  it("backs off after the server rejects a pass, then retries it", async () => {
    let clock = 1_000;
    const server = createFakeServer();
    const storage = createMemoryStorage();
    await launch(storage, server, () => clock);

    server.failNextPost = 413;
    storage.setItem("synara:composer-drafts:v1", "draft");
    await vi.waitFor(() => expect(server.failNextPost).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.entries.has("synara:composer-drafts:v1")).toBe(false);

    clock += 31_000;
    await vi.waitFor(() => expect(server.entries.get("synara:composer-drafts:v1")).toBe("draft"));
  });

  it("does not mirror when the stored copy could not be read", async () => {
    const storage = createMemoryStorage();
    const posts: unknown[] = [];
    const stop = await restoreLatticeEmbedStorageWith({
      storage,
      token: TOKEN,
      origin: ORIGIN,
      intervalMs: 5,
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") posts.push(init.body);
        return new Response("unavailable", { status: 503 });
      }) as typeof fetch,
    });

    expect(stop).toBeNull();
    storage.setItem("synara:app-settings:v1", "{}");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(posts).toEqual([]);
  });

  it("rejects a stored copy with keys outside Synara's namespace", async () => {
    const storage = createMemoryStorage();
    const stop = await launch(storage, createFakeServer({ "lattice:recent": "x" }));

    expect(stop).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("diffs against what the server last accepted", () => {
    const storage = createMemoryStorage();
    storage.setItem("synara:a", "same");
    storage.setItem("synara:b", "changed");
    storage.setItem("other", "ignored");

    expect(
      diffLatticeEmbedStorage(
        new Map([
          ["synara:a", "same"],
          ["synara:b", "before"],
          ["synara:c", "gone"],
        ]),
        storage,
      ),
    ).toEqual({ set: { "synara:b": "changed" }, remove: ["synara:c"] });
    expect(diffLatticeEmbedStorage(new Map([["synara:a", "same"]]), createMemoryStorage())).toEqual(
      { set: {}, remove: ["synara:a"] },
    );
  });
});

// Lattice binds each embedded Synara frame to one workspace project, but every
// frame's store holds every project's threads, so a toast, a task card or a
// fork link can send the frame to another project's thread. The thread route
// must leave such a thread every time, not only the first time in a document,
// and must never leave the panel empty.
import "../index.css";

import {
  COMPUTER_WS_METHODS,
  DEVICE_WS_METHODS,
  EventId,
  type MessageId,
  ORCHESTRATION_WS_METHODS,
  type OrchestrationReadModel,
  ProjectId,
  ThreadId,
  TurnId,
  WS_METHODS,
  type WsWelcomePayload,
} from "@synara/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { http, HttpResponse, ws } from "msw";
import { setupWorker } from "msw/browser";
import { StrictMode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useComposerDraftStore } from "../composerDraftStore";
import { getRouter } from "../router";
import { useStore } from "../store";
import { initialState } from "../storeState";
import {
  createBrowserTestServerConfig,
  createBrowserTestServerSettings,
  createFullscreenTestHost,
} from "../test/browserHarness";
import {
  createShellSnapshotFromReadModel,
  flattenEffectRpcRequestPayload,
  readEffectRpcClientMessage,
  sendEffectRpcChunk,
  sendEffectRpcExit,
} from "../test/effectRpcWebSocketMock";
import { resetWsNativeApiForTest } from "../wsNativeApi";

const NOW_ISO = "2026-03-04T12:00:00.000Z";
const EMBED_MODE_STORAGE_KEY = "synara.poc.embed-mode";
const ALPHA_PROJECT_ID = ProjectId.makeUnsafe("project-alpha");
const BETA_PROJECT_ID = ProjectId.makeUnsafe("project-beta");
const ALPHA_THREAD_ID = ThreadId.makeUnsafe("thread-alpha-1");
const OLDER_ALPHA_THREAD_ID = ThreadId.makeUnsafe("thread-alpha-0");
const BETA_THREAD_1 = ThreadId.makeUnsafe("thread-beta-1");
const BETA_THREAD_2 = ThreadId.makeUnsafe("thread-beta-2");
const COMPOSER_SELECTOR = '[data-chat-composer-form="true"]';
const FOREIGN_FALLBACK_TEXT = "This conversation belongs to another project.";

const serverConfig = createBrowserTestServerConfig(NOW_ISO);
let snapshot: OrchestrationReadModel;
let welcome: WsWelcomePayload;

function project(id: ProjectId, title: string, workspaceRoot: string) {
  return {
    id,
    kind: "project" as const,
    title,
    workspaceRoot,
    defaultModelSelection: { provider: "codex" as const, model: "gpt-5" },
    scripts: [],
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    deletedAt: null,
  };
}

type ReadModelThread = OrchestrationReadModel["threads"][number];

function thread(
  id: ThreadId,
  projectId: ProjectId,
  text: string,
  updatedAt = NOW_ISO,
): ReadModelThread {
  return {
    id,
    projectId,
    title: text,
    modelSelection: { provider: "codex", model: "gpt-5" },
    interactionMode: "default",
    runtimeMode: "full-access",
    envMode: "local",
    branch: "main",
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW_ISO,
    updatedAt,
    deletedAt: null,
    handoff: null,
    messages: [
      {
        id: `${id}-message` as MessageId,
        role: "user",
        text,
        turnId: null,
        streaming: false,
        source: "native",
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
      },
    ],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: {
      threadId: id,
      status: "ready",
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: NOW_ISO,
    },
  };
}

function buildSnapshot(alphaThreads: ReadModelThread[]): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    spaces: [],
    projects: [
      project(ALPHA_PROJECT_ID, "Alpha", "/work/alpha"),
      project(BETA_PROJECT_ID, "Beta", "/work/beta"),
    ],
    threads: [
      ...alphaThreads,
      thread(BETA_THREAD_1, BETA_PROJECT_ID, "Beta first conversation"),
      thread(BETA_THREAD_2, BETA_PROJECT_ID, "Beta second conversation"),
    ],
    updatedAt: NOW_ISO,
  };
}

function resolveWsRpc(tag: string): unknown {
  if (tag === ORCHESTRATION_WS_METHODS.getShellSnapshot) {
    return createShellSnapshotFromReadModel(snapshot);
  }
  if (tag === ORCHESTRATION_WS_METHODS.getSnapshot) return snapshot;
  if (tag === WS_METHODS.serverGetSettings) return createBrowserTestServerSettings(NOW_ISO);
  if (tag === WS_METHODS.serverGetConfig) return serverConfig;
  if (tag === WS_METHODS.projectsListDevServers) return { servers: [] };
  if (tag === WS_METHODS.automationList) return { definitions: [], runs: [] };
  if (tag === WS_METHODS.todoList) return { todos: [] };
  if (tag === WS_METHODS.gitListBranches) {
    return {
      isRepo: true,
      hasOriginRemote: true,
      branches: [{ name: "main", current: true, isDefault: true, worktreePath: null }],
    };
  }
  if (tag === WS_METHODS.gitStatus) {
    return {
      branch: "main",
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };
  }
  if (tag === WS_METHODS.projectsSearchEntries) return { entries: [], truncated: false };
  return {};
}

const wsLink = ws.link(/ws(s)?:\/\/.*/);
const worker = setupWorker(
  wsLink.addEventListener("connection", ({ client }) => {
    client.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const parsed = readEffectRpcClientMessage(client, event.data);
      if (parsed.kind !== "request") return;
      const body = flattenEffectRpcRequestPayload(parsed.request.tag, parsed.request.payload);
      const method = body._tag;
      if (method === WS_METHODS.subscribeServerLifecycle) {
        sendEffectRpcChunk(client, parsed.request.id, { type: "welcome", payload: welcome });
        return;
      }
      if (method === WS_METHODS.subscribeServerConfig) {
        sendEffectRpcChunk(client, parsed.request.id, { type: "snapshot", config: serverConfig });
        return;
      }
      if (method === ORCHESTRATION_WS_METHODS.subscribeShell) {
        sendEffectRpcChunk(client, parsed.request.id, {
          kind: "snapshot",
          snapshot: createShellSnapshotFromReadModel(snapshot),
        });
        return;
      }
      if (method === ORCHESTRATION_WS_METHODS.subscribeThread && "threadId" in body) {
        const detail = snapshot.threads.find((entry) => entry.id === body.threadId);
        if (!detail) return;
        sendEffectRpcChunk(client, parsed.request.id, {
          kind: "snapshot",
          snapshot: { snapshotSequence: snapshot.snapshotSequence, thread: detail },
        });
        return;
      }
      if (
        method === WS_METHODS.subscribeServerProviderStatuses ||
        method === WS_METHODS.subscribeServerSettings ||
        method === WS_METHODS.subscribeServerKeepAwake ||
        method === WS_METHODS.subscribeTerminalEvents ||
        method === WS_METHODS.subscribeOrchestrationDomainEvents ||
        method === WS_METHODS.subscribeProjectDevServerEvents ||
        method === WS_METHODS.subscribeAutomationEvents ||
        method === WS_METHODS.subscribeTodoEvents ||
        // Infinite subscriptions stay open; an Exit reads as a dead socket and reconnects.
        method === DEVICE_WS_METHODS.subscribeEvents ||
        method === COMPUTER_WS_METHODS.subscribeEvents
      ) {
        return;
      }
      sendEffectRpcExit(client, parsed.request.id, resolveWsRpc(method));
    });
  }),
  http.get("*/attachments/:attachmentId", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
);

async function waitForWsMockInterception(): Promise<void> {
  // A socket opened before the service worker activates bypasses the mock.
  await vi.waitFor(
    async () => {
      const socket = new WebSocket(`ws://${window.location.host}/__mock-interception-probe`);
      try {
        await vi.waitFor(() => expect(wsLink.clients.size).toBeGreaterThan(0), {
          timeout: 1_000,
          interval: 16,
        });
      } finally {
        socket.close();
      }
    },
    { timeout: 30_000, interval: 250 },
  );
}

function routeThreadId(router: ReturnType<typeof getRouter>): ThreadId {
  return ThreadId.makeUnsafe(router.state.location.pathname.slice(1));
}

function panelText(host: HTMLElement): string {
  return host.innerText.trim();
}

async function mountEmbeddedPanel(initialThreadId: ThreadId, options?: { strict?: boolean }) {
  const host = createFullscreenTestHost();
  const router = getRouter(createMemoryHistory({ initialEntries: [`/${initialThreadId}`] }));
  const app = <RouterProvider router={router} />;
  // main.tsx mounts the app in StrictMode, which replays every effect's mount after its cleanup.
  const screen = await render(options?.strict ? <StrictMode>{app}</StrictMode> : app, {
    container: host,
  });
  return {
    host,
    router,
    cleanup: async () => {
      await screen.unmount();
      if (host.isConnected) host.remove();
      await router.options.context.queryClient.cancelQueries();
      router.options.context.queryClient.clear();
    },
  };
}

type Panel = Awaited<ReturnType<typeof mountEmbeddedPanel>>;

async function expectComposerOnOwnThread(panel: Panel, expectedThreadId?: ThreadId) {
  await vi.waitFor(
    () => {
      const current = routeThreadId(panel.router);
      expect(current, "the frame stayed on another project's thread").not.toMatch(/^thread-beta/);
      if (expectedThreadId) expect(current).toBe(expectedThreadId);
      expect(panel.host.querySelector(COMPOSER_SELECTOR), "the panel has no composer").not.toBe(
        null,
      );
    },
    { timeout: 20_000, interval: 16 },
  );
  // The shipped bug left the panel empty for good: still rendered a moment later.
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(panel.host.querySelector(COMPOSER_SELECTOR)).not.toBe(null);
  expect(panelText(panel.host).length).toBeGreaterThan(0);
}

// The Open action of a toast or task card: an in-frame `/$threadId` navigation.
async function openThread(panel: Panel, threadId: ThreadId) {
  await panel.router.navigate({
    to: "/$threadId",
    params: { threadId },
    search: (previous: Record<string, unknown>) => ({ ...previous, splitViewId: undefined }),
  });
}

vi.setConfig({ hookTimeout: 150_000 });

describe("embedded thread route on another project's thread", () => {
  beforeAll(async () => {
    snapshot = buildSnapshot([thread(ALPHA_THREAD_ID, ALPHA_PROJECT_ID, "Alpha conversation")]);
    welcome = {
      cwd: "/work/alpha",
      projectName: "Alpha",
      bootstrapProjectId: ALPHA_PROJECT_ID,
      bootstrapThreadId: ALPHA_THREAD_ID,
    };
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: { url: "/mockServiceWorker.js" },
    });
    await waitForWsMockInterception();
    // Warm the code-split routes so a cold transform cannot eat the first test's budget.
    // A warmup that times out is ignored: the fetched chunks stay cached either way.
    const warmup = await mountEmbeddedPanel(ALPHA_THREAD_ID);
    try {
      await vi.waitFor(() => expect(warmup.host.querySelector(COMPOSER_SELECTOR)).not.toBe(null), {
        timeout: 80_000,
        interval: 50,
      });
    } catch {
      // Deliberately ignored, reason above.
    } finally {
      await warmup.cleanup();
    }
  });

  afterAll(async () => {
    sessionStorage.removeItem(EMBED_MODE_STORAGE_KEY);
    await resetWsNativeApiForTest();
    await worker.stop();
  });

  beforeEach(async () => {
    await resetWsNativeApiForTest();
    localStorage.clear();
    document.body.innerHTML = "";
    sessionStorage.setItem(
      EMBED_MODE_STORAGE_KEY,
      JSON.stringify({
        workspaceRoot: "/work/alpha",
        theme: "light",
        surface: "chrome",
        hostOrigin: window.location.origin,
        locale: "en",
      }),
    );
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
    useStore.setState(initialState);
    snapshot = buildSnapshot([thread(ALPHA_THREAD_ID, ALPHA_PROJECT_ID, "Alpha conversation")]);
  });

  const orders: Array<{ name: string; visits: ThreadId[] }> = [
    {
      name: "two different foreign threads",
      visits: [BETA_THREAD_1, BETA_THREAD_2, BETA_THREAD_1],
    },
    {
      name: "the same foreign thread twice",
      visits: [BETA_THREAD_1, BETA_THREAD_1, BETA_THREAD_1],
    },
  ];

  for (const order of orders) {
    it(`returns to the frame's own conversation every time (${order.name})`, async () => {
      const panel = await mountEmbeddedPanel(ALPHA_THREAD_ID);
      try {
        await expectComposerOnOwnThread(panel, ALPHA_THREAD_ID);
        for (const visit of order.visits) {
          await openThread(panel, visit);
          await expectComposerOnOwnThread(panel, ALPHA_THREAD_ID);
        }
        // Leaving never minted an empty thread for Lattice to persist over the conversation.
        expect(useComposerDraftStore.getState().draftThreadsByThreadId).toEqual({});
      } finally {
        await panel.cleanup();
      }
    });
  }

  it("opens the project's most recent thread when the frame starts on a foreign thread", async () => {
    snapshot = buildSnapshot([
      thread(OLDER_ALPHA_THREAD_ID, ALPHA_PROJECT_ID, "Older alpha", "2026-03-01T12:00:00.000Z"),
      thread(ALPHA_THREAD_ID, ALPHA_PROJECT_ID, "Alpha conversation", "2026-03-04T12:00:00.000Z"),
    ]);
    const panel = await mountEmbeddedPanel(BETA_THREAD_1);
    try {
      await expectComposerOnOwnThread(panel, ALPHA_THREAD_ID);
      await openThread(panel, BETA_THREAD_2);
      await expectComposerOnOwnThread(panel, ALPHA_THREAD_ID);
    } finally {
      await panel.cleanup();
    }
  });

  it("reuses one chat draft when the frame's project has no thread yet", async () => {
    snapshot = buildSnapshot([]);
    const panel = await mountEmbeddedPanel(BETA_THREAD_1);
    try {
      await expectComposerOnOwnThread(panel);
      const draftThreadId = routeThreadId(panel.router);
      expect(useComposerDraftStore.getState().draftThreadsByThreadId[draftThreadId]).toMatchObject({
        projectId: ALPHA_PROJECT_ID,
      });
      await openThread(panel, BETA_THREAD_2);
      await expectComposerOnOwnThread(panel);
      expect(routeThreadId(panel.router)).toBe(draftThreadId);
      expect(Object.keys(useComposerDraftStore.getState().draftThreadsByThreadId)).toEqual([
        draftThreadId,
      ]);
    } finally {
      await panel.cleanup();
    }
  });

  it.each([
    { name: "plain", strict: false },
    { name: "StrictMode, as main.tsx mounts it", strict: true },
  ])(
    "shows a way back instead of an empty panel when leaving is blocked ($name)",
    async ({ strict }) => {
      const panel = await mountEmbeddedPanel(ALPHA_THREAD_ID, { strict });
      let unblock: (() => void) | null = null;
      try {
        await expectComposerOnOwnThread(panel, ALPHA_THREAD_ID);
        // A route blocker (an unsaved editor whose save failed) refuses to leave the thread.
        unblock = panel.router.history.block({
          // True blocks the navigation.
          blockerFn: ({ currentLocation }) => currentLocation.pathname.startsWith("/thread-beta"),
        });
        await openThread(panel, BETA_THREAD_1);
        await vi.waitFor(
          () => {
            expect(routeThreadId(panel.router)).toBe(BETA_THREAD_1);
            expect(panelText(panel.host)).toContain(FOREIGN_FALLBACK_TEXT);
          },
          { timeout: 20_000, interval: 16 },
        );
        unblock?.();
        const back = Array.from(panel.host.querySelectorAll("button")).find(
          (button) => button.textContent?.trim() === "Back",
        );
        expect(back, "the fallback has no Back button").toBeDefined();
        back!.click();
        await expectComposerOnOwnThread(panel, ALPHA_THREAD_ID);
      } finally {
        unblock?.();
        await panel.cleanup();
      }
    },
  );

  // create_task can target another project; the card's Open must not take the frame there.
  it("refuses to open another project's task from the transcript", async () => {
    const alpha = thread(ALPHA_THREAD_ID, ALPHA_PROJECT_ID, "Alpha conversation");
    const turnId = TurnId.makeUnsafe("turn-create-task");
    const assistantMessageId = `${ALPHA_THREAD_ID}-reply` as MessageId;
    snapshot = buildSnapshot([
      {
        ...alpha,
        // The card shows under the settled turn's answer.
        latestTurn: {
          turnId,
          state: "completed",
          requestedAt: NOW_ISO,
          startedAt: NOW_ISO,
          completedAt: NOW_ISO,
          assistantMessageId,
        },
        messages: [
          { ...alpha.messages[0]!, turnId },
          {
            ...alpha.messages[0]!,
            id: assistantMessageId,
            role: "assistant",
            text: "Created the task in Beta.",
            turnId,
          },
        ],
        activities: [
          {
            id: EventId.makeUnsafe("activity-create-beta-task"),
            tone: "info",
            kind: "synara.threads.created",
            summary: "Task created",
            payload: {
              operationId: "create:beta",
              threads: [
                {
                  threadId: BETA_THREAD_1,
                  title: "Beta task",
                  provider: "codex",
                  model: "gpt-5",
                  environment: "local",
                },
              ],
            },
            turnId,
            createdAt: NOW_ISO,
          },
        ],
      },
    ]);
    const panel = await mountEmbeddedPanel(ALPHA_THREAD_ID);
    const visited: string[] = [];
    // Every history entry, including one the route replaces at once when it leaves a thread.
    const unsubscribe = panel.router.history.subscribe(({ location }) => {
      visited.push(location.pathname);
    });
    try {
      await expectComposerOnOwnThread(panel, ALPHA_THREAD_ID);
      const open = await vi.waitFor(
        () => {
          const button = panel.host.querySelector<HTMLButtonElement>(
            '[data-synara-thread-creation-card="true"] button',
          );
          expect(button, "the task card did not render").not.toBe(null);
          return button!;
        },
        { timeout: 20_000, interval: 16 },
      );
      open.click();
      await expectComposerOnOwnThread(panel, ALPHA_THREAD_ID);
      expect(visited.filter((pathname) => pathname.startsWith("/thread-beta"))).toEqual([]);
    } finally {
      unsubscribe();
      await panel.cleanup();
    }
  });
});

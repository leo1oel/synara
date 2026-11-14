// Every Lattice window embeds its own Synara frame, and each frame's store holds
// every project's threads. A thread event must toast only in the frame whose
// workspace owns the thread, or the frontmost window raises (and opens) another
// window's thread.
import { DEFAULT_RUNTIME_MODE, EventId, ProjectId, ThreadId, TurnId } from "@synara/contracts";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import "../index.css";

import type { EmbedModeConfig } from "../embedMode";

const route = vi.hoisted(() => ({ navigate: vi.fn() }));
const embed = vi.hoisted(() => ({ config: null as EmbedModeConfig | null }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => route.navigate,
  useParams: () => null,
}));
vi.mock("../hooks/useDiffRouteSearch", () => ({ useDiffRouteSearch: () => ({}) }));
vi.mock("../appSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../appSettings")>()),
  useAppSettings: () => ({
    settings: {
      enableTaskCompletionToasts: true,
      enableSystemTaskCompletionNotifications: false,
      notifyAfterSubagentsFinish: false,
    },
  }),
}));
vi.mock("../embedMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../embedMode")>()),
  readEmbedMode: () => embed.config,
}));

import { TaskCompletionNotifications } from "../notifications/taskCompletion";
import { useStore } from "../store";
import { initialState } from "../storeState";
import { makeReadModel, makeReadModelProject, makeReadModelThread } from "../storeTestFixtures";
import { useTerminalStateStore, type ThreadTerminalState } from "../terminalStateStore";
import { ToastProvider, toastManager } from "./ui/toast";
import { SYNARA_EMBEDDED_NOTIFICATION } from "./ui/embeddedToastBridge";

const alphaProjectId = ProjectId.makeUnsafe("project-alpha");
const betaProjectId = ProjectId.makeUnsafe("project-beta");
const alphaThreadId = ThreadId.makeUnsafe("thread-alpha");
const turnId = TurnId.makeUnsafe("turn-alpha");
const title = "Alpha refactor";
const snoozeReceiptKey = `synara:snooze-reminder:v1:${alphaThreadId}`;

function embedFor(workspaceRoot: string): EmbedModeConfig {
  return {
    workspaceRoot,
    theme: "light",
    surface: "chrome",
    hostOrigin: window.location.origin,
    locale: "en",
  };
}

let root: Root;
let host: HTMLDivElement;
let snapshotSequence: number;
let toastIds: Array<ReturnType<typeof toastManager.add>>;
let addToast: MockInstance<typeof toastManager.add>;
let postToHost: MockInstance<typeof window.parent.postMessage>;

type ThreadOverrides = Parameters<typeof makeReadModelThread>[0];

function syncAlphaThread(overrides: ThreadOverrides) {
  const base = makeReadModel(
    makeReadModelThread({ id: alphaThreadId, projectId: alphaProjectId, title, ...overrides }),
  );
  flushSync(() =>
    useStore.getState().syncServerReadModel({
      ...base,
      snapshotSequence: ++snapshotSequence,
      projects: [
        makeReadModelProject({ id: alphaProjectId, title: "Alpha", workspaceRoot: "/work/alpha" }),
        makeReadModelProject({ id: betaProjectId, title: "Beta", workspaceRoot: "/work/beta" }),
      ],
    }),
  );
}

function setAlphaTerminal(state: Partial<ThreadTerminalState>) {
  flushSync(() =>
    useTerminalStateStore.setState({
      terminalStateByThreadId: {
        [alphaThreadId]: {
          terminalIds: ["term-1"],
          terminalLabelsById: { "term-1": "Build" },
          terminalTitleOverridesById: {},
          terminalCliKindsById: {},
          terminalAttentionStatesById: {},
          runningTerminalIds: [],
          ...state,
        } as ThreadTerminalState,
      },
    }),
  );
}

function renderRuntime() {
  flushSync(() =>
    root.render(
      <ToastProvider>
        <TaskCompletionNotifications />
      </ToastProvider>,
    ),
  );
}

const turnStartedAt = () => new Date(Date.now() + 1_000).toISOString();

function session(status: "running" | "ready") {
  return {
    threadId: alphaThreadId,
    status,
    providerName: "codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    activeTurnId: status === "running" ? turnId : null,
    lastError: null,
    updatedAt: turnStartedAt(),
  } as const;
}

function runningTurn() {
  return {
    turnId,
    state: "running",
    requestedAt: turnStartedAt(),
    startedAt: turnStartedAt(),
    completedAt: null,
    assistantMessageId: null,
  } as const;
}

function runAlphaTurn() {
  syncAlphaThread({ latestTurn: runningTurn(), session: session("running") });
}

function completeAlphaTurn() {
  syncAlphaThread({
    latestTurn: {
      ...runningTurn(),
      state: "completed",
      completedAt: new Date(Date.now() + 2_000).toISOString(),
    },
    session: session("ready"),
  });
}

function requestAlphaApproval() {
  syncAlphaThread({
    latestTurn: runningTurn(),
    session: session("running"),
    activities: [
      {
        id: EventId.makeUnsafe("activity-approval-alpha"),
        tone: "approval",
        kind: "approval.requested",
        summary: "Command approval requested",
        payload: { requestId: "approval-alpha", requestKind: "command" },
        turnId,
        createdAt: new Date(Date.now() + 2_000).toISOString(),
      },
    ],
  });
}

const scenarios = [
  {
    name: "chat completion",
    before: runAlphaTurn,
    event: completeAlphaTurn,
  },
  {
    name: "input needed",
    before: runAlphaTurn,
    event: requestAlphaApproval,
  },
  {
    name: "terminal completion",
    before: () => {
      syncAlphaThread({});
      setAlphaTerminal({ runningTerminalIds: ["term-1"] });
    },
    event: () => setAlphaTerminal({ terminalAttentionStatesById: { "term-1": "review" } }),
  },
  {
    name: "terminal attention",
    before: () => {
      syncAlphaThread({});
      setAlphaTerminal({ runningTerminalIds: ["term-1"] });
    },
    event: () =>
      setAlphaTerminal({
        runningTerminalIds: ["term-1"],
        terminalAttentionStatesById: { "term-1": "attention" },
      }),
  },
];

async function deliver(scenario: (typeof scenarios)[number]) {
  scenario.before();
  renderRuntime();
  // The runtime baselines its first hydrated snapshot; the next change notifies.
  await Promise.resolve();
  scenario.event();
  await Promise.resolve();
}

function hostUpserts() {
  return postToHost.mock.calls
    .map(([message]) => message as { type?: string; operation?: string })
    .filter(
      (message) => message?.type === SYNARA_EMBEDDED_NOTIFICATION && message.operation === "upsert",
    );
}

beforeEach(() => {
  snapshotSequence = 0;
  toastIds = [];
  embed.config = null;
  route.navigate.mockReset();
  useStore.setState(initialState);
  useTerminalStateStore.setState({ terminalStateByThreadId: {} });
  const realAdd = toastManager.add.bind(toastManager);
  addToast = vi.spyOn(toastManager, "add").mockImplementation((options) => {
    const id = realAdd(options);
    toastIds.push(id);
    return id;
  });
  postToHost = vi.spyOn(window.parent, "postMessage");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => {
    for (const id of toastIds) toastManager.close(id);
  });
  flushSync(() => root.unmount());
  host.remove();
  useStore.setState(initialState);
  useTerminalStateStore.setState({ terminalStateByThreadId: {} });
  window.localStorage.removeItem(snoozeReceiptKey);
  vi.restoreAllMocks();
});

describe("thread notifications in a Lattice embed", () => {
  for (const scenario of scenarios) {
    it(`does not raise a ${scenario.name} toast for another workspace's thread`, async () => {
      embed.config = embedFor("/work/beta");
      await deliver(scenario);
      expect(addToast).not.toHaveBeenCalled();
      expect(hostUpserts()).toEqual([]);
    });

    it(`raises a ${scenario.name} toast in the frame that owns the thread`, async () => {
      // Roots compare normalized, as everywhere else the embed matches workspaces.
      embed.config = embedFor("/work/alpha/");
      await deliver(scenario);
      await expect.poll(() => addToast.mock.calls.length).toBe(1);
      expect(addToast.mock.calls[0]![0].data).toMatchObject({ threadId: alphaThreadId });
      await expect.poll(() => hostUpserts().length).toBe(1);
    });

    it(`keeps standalone ${scenario.name} toasts for every thread`, async () => {
      await deliver(scenario);
      await expect.poll(() => addToast.mock.calls.length).toBe(1);
      expect(addToast.mock.calls[0]![0].data).toMatchObject({ threadId: alphaThreadId });
    });
  }
});

describe("snooze reminders in a Lattice embed", () => {
  const reminderAt = "2026-02-27T09:00:00.000Z";

  it("leaves another workspace's reminder unclaimed for the frame that owns it", async () => {
    syncAlphaThread({ snoozedUntil: null, snoozeReminderAt: reminderAt });
    embed.config = embedFor("/work/beta");
    renderRuntime();
    await Promise.resolve();
    await Promise.resolve();
    expect(addToast).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(snoozeReceiptKey)).toBeNull();

    flushSync(() => root.unmount());
    embed.config = embedFor("/work/alpha");
    root = createRoot(host);
    renderRuntime();
    await expect.poll(() => addToast.mock.calls.length).toBe(1);
    expect(addToast.mock.calls[0]![0].data).toMatchObject({ threadId: alphaThreadId });
    expect(window.localStorage.getItem(snoozeReceiptKey)).toBe(reminderAt);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildLatticeProjectHistoryCheckpoints,
  embedWorkspaceMatches,
  initializeEmbedMode,
  postEmbedReadyToLattice,
  postHostContextRequestToLattice,
  postHostContextSelectionClearToLattice,
  postProjectHistoryToLattice,
  readEmbedMode,
  readEmbeddedHostWsUrl,
  readLatticeCheckpointRestoreMessage,
  readLatticeHostContextMessage,
  LATTICE_HOST_CONTEXT,
  LATTICE_HOST_CONTEXT_REQUEST,
  LATTICE_HOST_CONTEXT_SELECTION_CLEAR,
  LATTICE_PROJECT_HISTORY,
  LATTICE_RESTORE_AGENT_CHECKPOINT,
  SYNARA_EMBED_READY,
} from "./embedMode";

function installBrowserStubs(theme: "light" | "dark" = "dark") {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const replaceState = vi.fn();
  const postMessage = vi.fn();
  const setProperty = vi.fn();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        origin: "http://127.0.0.1:4567",
        pathname: "/",
        search: `?embed=1&workspaceRoot=%2FUsers%2Fme%2Fpaper&theme=${theme}&hostOrigin=http%3A%2F%2Flocalhost%3A1420`,
        hash: "#lattice-auth=secret-token",
      },
      history: { state: null, replaceState },
      parent: { postMessage },
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      referrer: "",
      documentElement: {
        dataset: {},
        classList: { toggle: vi.fn() },
        style: { setProperty },
      },
    },
  });
  return { postMessage, replaceState, setProperty };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Lattice embed mode", () => {
  it("moves the sidecar credential out of the fragment before opening WebSocket RPC", () => {
    const { replaceState } = installBrowserStubs();

    initializeEmbedMode();

    expect(readEmbedMode()).toEqual({
      workspaceRoot: "/Users/me/paper",
      theme: "dark",
      hostOrigin: "http://localhost:1420",
    });
    expect(readEmbeddedHostWsUrl()).toBe("ws://127.0.0.1:4567/?token=secret-token");
    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/?embed=1&workspaceRoot=%2FUsers%2Fme%2Fpaper&theme=dark&hostOrigin=http%3A%2F%2Flocalhost%3A1420",
    );
  });

  it("reports readiness only to the configured Lattice origin", () => {
    const { postMessage } = installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode();
    expect(config).not.toBeNull();

    postEmbedReadyToLattice(config!);

    expect(postMessage).toHaveBeenCalledWith({ type: SYNARA_EMBED_READY }, "http://localhost:1420");
  });

  it("uses Lattice's shared light side surface in embedded mode", () => {
    const { setProperty } = installBrowserStubs("light");

    initializeEmbedMode();

    expect(setProperty).toHaveBeenCalledWith("--app-shell-background", "#f9f9fa");
    expect(setProperty).toHaveBeenCalledWith("--color-background-panel", "#f9f9fa");
    expect(setProperty).toHaveBeenCalledWith("--sidebar", "#f9f9fa");
  });

  it("uses Lattice's shared dark side surface in embedded mode", () => {
    const { setProperty } = installBrowserStubs("dark");

    initializeEmbedMode();

    expect(setProperty).toHaveBeenCalledWith("--app-shell-background", "#1b1b1d");
    expect(setProperty).toHaveBeenCalledWith("--color-background-panel", "#1b1b1d");
    expect(setProperty).toHaveBeenCalledWith("--sidebar", "#1b1b1d");
  });

  it("matches the embedded workspace without crashing on partially hydrated projects", () => {
    installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode();
    expect(config).not.toBeNull();

    expect(embedWorkspaceMatches(config!, undefined)).toBe(false);
    expect(embedWorkspaceMatches(config!, null)).toBe(false);
    expect(embedWorkspaceMatches(config!, "  ")).toBe(false);
    expect(embedWorkspaceMatches(config!, "/Users/me/paper/")).toBe(true);
  });

  it("builds project history from normalized summaries and tolerates partial hydration", () => {
    const baseInput = {
      threadId: "thread-1",
      threadTitle: "Revise introduction",
      inferredCheckpointTurnCountByTurnId: {},
    };
    expect(buildLatticeProjectHistoryCheckpoints({
      ...baseInput,
      messages: undefined,
      summaries: undefined,
    })).toEqual([]);

    expect(buildLatticeProjectHistoryCheckpoints({
      ...baseInput,
      messages: [{
        role: "user",
        turnId: "turn-1",
        text: "Improve   the introduction",
      }],
      summaries: [{
        turnId: "turn-1",
        completedAt: "2026-07-29T12:00:00Z",
        status: "ready",
        checkpointRef: "refs/lattice/checkpoints/one",
        checkpointTurnCount: 1,
        files: [{ path: "main.tex", additions: 4, deletions: 2 }],
      }],
    })).toEqual([{
      id: "agent:thread-1:turn-1",
      label: "Agent: Improve the introduction",
      timestamp: "2026-07-29T12:00:00Z",
      threadId: "thread-1",
      threadTitle: "Revise introduction",
      turnId: "turn-1",
      turnCount: 1,
      checkpointRef: "refs/lattice/checkpoints/one",
      files: [{
        path: "main.tex",
        kind: "modified",
        additions: 4,
        deletions: 2,
      }],
    }]);
  });

  it("shares checkpoint summaries with Lattice and validates restore requests", () => {
    const { postMessage } = installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode();
    expect(config).not.toBeNull();
    const entries = [{
      id: "agent:thread-1:turn-1",
      label: "Agent revised the introduction",
      timestamp: "2026-07-29T12:00:00Z",
      threadId: "thread-1",
      threadTitle: "Revise introduction",
      turnId: "turn-1",
      turnCount: 1,
      checkpointRef: "refs/lattice/checkpoints/one",
      files: [{ path: "main.tex", kind: "modified", additions: 4, deletions: 2 }],
    }];

    postProjectHistoryToLattice(config!, "thread-1", entries);

    expect(postMessage).toHaveBeenCalledWith(
      { type: LATTICE_PROJECT_HISTORY, activeThreadId: "thread-1", entries },
      "http://localhost:1420",
    );
    expect(readLatticeCheckpointRestoreMessage({
      source: window.parent,
      origin: "http://localhost:1420",
      data: {
        type: LATTICE_RESTORE_AGENT_CHECKPOINT,
        threadId: "thread-1",
        turnCount: 1,
      },
    } as MessageEvent, config!)).toEqual({
      type: LATTICE_RESTORE_AGENT_CHECKPOINT,
      threadId: "thread-1",
      turnCount: 1,
    });
  });

  it("accepts live host context only from the configured Lattice workspace", () => {
    const { postMessage } = installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode()!;
    const context = {
      type: LATTICE_HOST_CONTEXT,
      version: 1,
      workspaceRoot: "/Users/me/paper/",
      activeSurface: "editor",
      editor: {
        path: "main.tex",
        line: 8,
        column: 2,
        selection: "introduction",
      },
      pdf: { page: 2, pageCount: 6 },
    };

    expect(readLatticeHostContextMessage({
      source: window.parent,
      origin: "http://localhost:1420",
      data: context,
    } as MessageEvent, config)).toEqual(context);
    expect(readLatticeHostContextMessage({
      source: window.parent,
      origin: "http://localhost:1420",
      data: { ...context, workspaceRoot: "/Users/me/other" },
    } as MessageEvent, config)).toBeNull();

    postHostContextRequestToLattice(config);
    expect(postMessage).toHaveBeenCalledWith(
      { type: LATTICE_HOST_CONTEXT_REQUEST },
      "http://localhost:1420",
    );

    postHostContextSelectionClearToLattice(config);
    expect(postMessage).toHaveBeenCalledWith(
      { type: LATTICE_HOST_CONTEXT_SELECTION_CLEAR },
      "http://localhost:1420",
    );
  });
});

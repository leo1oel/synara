import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildLatticeProjectHistoryCheckpoints,
  embedWorkspaceMatches,
  initializeEmbedMode,
  postEmbedReadyToLattice,
  postOpenSettingsToLattice,
  openEmbeddedProviderSettings,
  postShowInFolderToLattice,
  postConfirmationRequestToLattice,
  postSettingsContentHeightToLattice,
  postSettingsWheelToLattice,
  postHostContextRequestToLattice,
  postHostContextSelectionClearToLattice,
  postPaperLibraryRequestToLattice,
  postProjectHistoryToLattice,
  readEmbedMode,
  readEmbeddedHostWsUrl,
  readLatticeAgentPanelOpenedMessage,
  readLatticeCheckpointRestoreMessage,
  readLatticeComposerFilesMessage,
  readLatticeHostContextMessage,
  readLatticePaperLibraryMessage,
  readLatticeConfirmationMessage,
  readLatticeHostPointerMessage,
  LATTICE_COMPOSER_FILES,
  LATTICE_HOST_POINTER,
  LATTICE_CONFIRMATION_ACK,
  LATTICE_CONFIRMATION_RESPONSE,
  LATTICE_AGENT_PANEL_OPENED,
  LATTICE_HOST_CONTEXT,
  LATTICE_HOST_CONTEXT_REQUEST,
  LATTICE_HOST_CONTEXT_SELECTION_CLEAR,
  LATTICE_PAPER_LIBRARY,
  LATTICE_PAPER_LIBRARY_REQUEST,
  LATTICE_PROJECT_HISTORY,
  LATTICE_RESTORE_AGENT_CHECKPOINT,
  SYNARA_EMBED_READY,
  SYNARA_CONFIRMATION_REQUEST,
  SYNARA_OPEN_SETTINGS,
  SYNARA_SETTINGS_CONTENT_HEIGHT,
  SYNARA_SETTINGS_WHEEL,
  SYNARA_SHOW_IN_FOLDER,
} from "./embedMode";

function installBrowserStubs(
  theme: "light" | "dark" = "dark",
  surface: "chrome" | "drawer" = "chrome",
  locale?: string,
) {
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
        search: `?embed=1&workspaceRoot=%2FUsers%2Fme%2Fpaper&theme=${theme}&surface=${surface}&hostOrigin=http%3A%2F%2Flocalhost%3A1420${locale ? `&locale=${encodeURIComponent(locale)}` : ""}`,
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
      surface: "chrome",
      hostOrigin: "http://localhost:1420",
      locale: "en",
    });
    expect(readEmbeddedHostWsUrl()).toBe("ws://127.0.0.1:4567/?token=secret-token");
    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/?embed=1&workspaceRoot=%2FUsers%2Fme%2Fpaper&theme=dark&surface=chrome&hostOrigin=http%3A%2F%2Flocalhost%3A1420",
    );
  });

  it("accepts only the Simplified Chinese locale from the initial query", () => {
    installBrowserStubs("dark", "chrome", "zh-CN");
    initializeEmbedMode();
    expect(readEmbedMode()?.locale).toBe("zh-CN");

    installBrowserStubs("dark", "chrome", "zh-TW");
    initializeEmbedMode();
    expect(readEmbedMode()?.locale).toBe("en");
  });

  it("reports readiness only to the configured Lattice origin", () => {
    const { postMessage } = installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode();
    expect(config).not.toBeNull();

    postEmbedReadyToLattice(config!);

    expect(postMessage).toHaveBeenCalledWith({ type: SYNARA_EMBED_READY }, "http://localhost:1420");
  });

  it("asks the trusted Lattice host to open a local skill folder", () => {
    const { postMessage } = installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode();
    expect(config).not.toBeNull();

    expect(postShowInFolderToLattice(config!, "/Users/me/.synara/skills")).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: SYNARA_SHOW_IN_FOLDER,
        path: "/Users/me/.synara/skills",
      },
      "http://localhost:1420",
    );
  });

  it("asks the trusted Lattice host to open provider settings", () => {
    const { postMessage } = installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode();
    expect(config).not.toBeNull();

    expect(postOpenSettingsToLattice(config!, "providers")).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: SYNARA_OPEN_SETTINGS,
        section: "providers",
      },
      "http://localhost:1420",
    );
  });

  it("still asks Lattice to open provider settings when hostOrigin was not stored", () => {
    const { postMessage } = installBrowserStubs();
    expect(
      postOpenSettingsToLattice(
        {
          workspaceRoot: "/Users/me/paper",
          theme: "dark",
          surface: "chrome",
          hostOrigin: null,
          locale: "en",
        },
        "providers",
      ),
    ).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: SYNARA_OPEN_SETTINGS,
        section: "providers",
      },
      "*",
    );
  });

  it("treats an iframe without stored embed config as a Lattice host hand-off", () => {
    const postMessage = vi.fn();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        parent: { postMessage },
      },
    });
    expect(openEmbeddedProviderSettings()).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      { type: SYNARA_OPEN_SETTINGS, section: "providers" },
      "*",
    );
  });

  it("sends bounded confirmation requests only to Lattice", () => {
    const { postMessage } = installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode();
    expect(config).not.toBeNull();

    postConfirmationRequestToLattice(config!, {
      id: "delete-thread-1",
      message: "Delete thread “Draft”?",
    });

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: SYNARA_CONFIRMATION_REQUEST,
        id: "delete-thread-1",
        message: "Delete thread “Draft”?",
      },
      "http://localhost:1420",
    );
  });

  it("accepts confirmation acknowledgements and results only from Lattice", () => {
    installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode();
    expect(config).not.toBeNull();
    const trustedSource = window.parent;

    expect(
      readLatticeConfirmationMessage(
        {
          source: trustedSource,
          origin: "http://localhost:1420",
          data: { type: LATTICE_CONFIRMATION_ACK, id: "delete-thread-1" },
        } as MessageEvent,
        config!,
        "delete-thread-1",
      ),
    ).toEqual({ type: LATTICE_CONFIRMATION_ACK, id: "delete-thread-1" });
    expect(
      readLatticeConfirmationMessage(
        {
          source: trustedSource,
          origin: "http://localhost:1420",
          data: {
            type: LATTICE_CONFIRMATION_RESPONSE,
            id: "delete-thread-1",
            confirmed: false,
          },
        } as MessageEvent,
        config!,
        "delete-thread-1",
      ),
    ).toEqual({
      type: LATTICE_CONFIRMATION_RESPONSE,
      id: "delete-thread-1",
      confirmed: false,
    });
    expect(
      readLatticeConfirmationMessage(
        {
          source: trustedSource,
          origin: "http://malicious.invalid",
          data: {
            type: LATTICE_CONFIRMATION_RESPONSE,
            id: "delete-thread-1",
            confirmed: true,
          },
        } as MessageEvent,
        config!,
        "delete-thread-1",
      ),
    ).toBeNull();
  });

  it("identifies the section that owns each embedded settings height", () => {
    const { postMessage } = installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode();
    expect(config).not.toBeNull();

    postSettingsContentHeightToLattice(config!, 812.2, "providers");

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: SYNARA_SETTINGS_CONTENT_HEIGHT,
        height: 813,
        section: "providers",
      },
      "http://localhost:1420",
    );
  });

  it("sends current settings height atomically with the forwarded wheel", () => {
    const { postMessage } = installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode();
    expect(config).not.toBeNull();

    postSettingsWheelToLattice(
      config!,
      { deltaX: 0, deltaY: 420, deltaMode: 0 },
      { height: 4_812.2, section: "providers" },
    );

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: SYNARA_SETTINGS_WHEEL,
        deltaX: 0,
        deltaY: 420,
        deltaMode: 0,
        contentHeight: 4_813,
        section: "providers",
      },
      "http://localhost:1420",
    );
  });

  it("uses Lattice's light chrome surface for the embedded Agent", () => {
    const { setProperty } = installBrowserStubs("light");

    initializeEmbedMode();

    expect(setProperty).toHaveBeenCalledWith("--app-shell-background", "#efeff0");
    expect(setProperty).toHaveBeenCalledWith("--color-background-panel", "#efeff0");
    expect(setProperty).toHaveBeenCalledWith("--sidebar", "#efeff0");
    expect(setProperty).toHaveBeenCalledWith("--popover", "#F9F9FA");
  });

  it("uses Lattice's light drawer surface for embedded feature panels", () => {
    const { setProperty } = installBrowserStubs("light", "drawer");

    initializeEmbedMode();

    expect(setProperty).toHaveBeenCalledWith("--app-shell-background", "#f9f9fa");
    expect(setProperty).toHaveBeenCalledWith("--color-background-panel", "#f9f9fa");
    expect(setProperty).toHaveBeenCalledWith("--sidebar", "#f9f9fa");
  });

  it("uses Lattice's shared settings geometry for embedded sections", () => {
    const { setProperty } = installBrowserStubs("light", "drawer");

    initializeEmbedMode();

    expect(setProperty).toHaveBeenCalledWith("--lattice-settings-content-max-width", "720px");
    expect(setProperty).toHaveBeenCalledWith("--lattice-settings-content-padding-inline", "40px");
    expect(setProperty).toHaveBeenCalledWith("--lattice-settings-frame-border-width", "1px");
    expect(setProperty).toHaveBeenCalledWith("--lattice-settings-frame-radius", "8px");
    expect(setProperty).toHaveBeenCalledWith("--lattice-settings-panel", "#F9F9FA");
  });

  it("runs the settings drawer a step above the chrome type scale, as Lattice does", () => {
    const drawer = installBrowserStubs("light", "drawer");
    initializeEmbedMode();

    expect(drawer.setProperty).toHaveBeenCalledWith("--lattice-type-heading-size", "20px");
    expect(drawer.setProperty).toHaveBeenCalledWith("--lattice-type-group-size", "14px");
    expect(drawer.setProperty).toHaveBeenCalledWith("--lattice-type-label-size", "13px");
    expect(drawer.setProperty).toHaveBeenCalledWith("--lattice-type-caption-size", "12px");
    expect(drawer.setProperty).toHaveBeenCalledWith("--lattice-settings-control-font-size", "13px");

    const chrome = installBrowserStubs("light", "chrome");
    initializeEmbedMode();

    expect(chrome.setProperty).toHaveBeenCalledWith("--lattice-type-heading-size", "18px");
    expect(chrome.setProperty).toHaveBeenCalledWith("--lattice-type-group-size", "13px");
    expect(chrome.setProperty).toHaveBeenCalledWith("--lattice-type-label-size", "12px");
    expect(chrome.setProperty).toHaveBeenCalledWith("--lattice-type-caption-size", "11px");
    expect(chrome.setProperty).toHaveBeenCalledWith("--lattice-settings-control-font-size", "12px");
  });

  it("uses Lattice's dark chrome surface for the embedded Agent", () => {
    const { setProperty } = installBrowserStubs("dark");

    initializeEmbedMode();

    expect(setProperty).toHaveBeenCalledWith("--app-shell-background", "#141416");
    expect(setProperty).toHaveBeenCalledWith("--color-background-panel", "#141416");
    expect(setProperty).toHaveBeenCalledWith("--color-text-foreground", "#e9e9e7");
    expect(setProperty).toHaveBeenCalledWith("--color-text-foreground-secondary", "#a4a4aa");
    expect(setProperty).toHaveBeenCalledWith("--sidebar", "#141416");
    expect(setProperty).toHaveBeenCalledWith("--composer-surface", "#202023");
    expect(setProperty).toHaveBeenCalledWith("--lattice-agent-composer-surface", "#202023");
  });

  it("uses Lattice's dark drawer surface for embedded feature panels", () => {
    const { setProperty } = installBrowserStubs("dark", "drawer");

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
    expect(
      buildLatticeProjectHistoryCheckpoints({
        ...baseInput,
        messages: undefined,
        summaries: undefined,
      }),
    ).toEqual([]);

    expect(
      buildLatticeProjectHistoryCheckpoints({
        ...baseInput,
        messages: [
          {
            role: "user",
            turnId: "turn-1",
            text: "Improve   the introduction",
          },
        ],
        summaries: [
          {
            turnId: "turn-1",
            completedAt: "2026-07-29T12:00:00Z",
            status: "ready",
            checkpointRef: "refs/lattice/checkpoints/one",
            checkpointTurnCount: 1,
            files: [{ path: "main.tex", additions: 4, deletions: 2 }],
          },
        ],
      }),
    ).toEqual([
      {
        id: "agent:thread-1:turn-1",
        label: "Agent: Improve the introduction",
        timestamp: "2026-07-29T12:00:00Z",
        threadId: "thread-1",
        threadTitle: "Revise introduction",
        turnId: "turn-1",
        turnCount: 1,
        checkpointRef: "refs/lattice/checkpoints/one",
        files: [
          {
            path: "main.tex",
            kind: "modified",
            additions: 4,
            deletions: 2,
          },
        ],
      },
    ]);
  });

  it("shares checkpoint summaries with Lattice and validates restore requests", () => {
    const { postMessage } = installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode();
    expect(config).not.toBeNull();
    const entries = [
      {
        id: "agent:thread-1:turn-1",
        label: "Agent revised the introduction",
        timestamp: "2026-07-29T12:00:00Z",
        threadId: "thread-1",
        threadTitle: "Revise introduction",
        turnId: "turn-1",
        turnCount: 1,
        checkpointRef: "refs/lattice/checkpoints/one",
        files: [{ path: "main.tex", kind: "modified", additions: 4, deletions: 2 }],
      },
    ];

    postProjectHistoryToLattice(config!, "thread-1", entries);

    expect(postMessage).toHaveBeenCalledWith(
      { type: LATTICE_PROJECT_HISTORY, activeThreadId: "thread-1", entries },
      "http://localhost:1420",
    );
    expect(
      readLatticeCheckpointRestoreMessage(
        {
          source: window.parent,
          origin: "http://localhost:1420",
          data: {
            type: LATTICE_RESTORE_AGENT_CHECKPOINT,
            threadId: "thread-1",
            turnCount: 1,
          },
        } as MessageEvent,
        config!,
      ),
    ).toEqual({
      type: LATTICE_RESTORE_AGENT_CHECKPOINT,
      threadId: "thread-1",
      turnCount: 1,
    });
  });

  it("turns relayed composer files into File objects exactly once", () => {
    installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode()!;
    const bytes = new TextEncoder().encode("png-bytes").buffer;
    const validData = {
      type: LATTICE_COMPOSER_FILES,
      version: 1,
      files: [{ name: "plot.png", mimeType: "image/png", bytes }],
    };
    const event = {
      source: window.parent,
      origin: "http://localhost:1420",
      data: validData,
    } as MessageEvent;

    const files = readLatticeComposerFilesMessage(event, config);
    expect(files).toHaveLength(1);
    expect(files![0]!.name).toBe("plot.png");
    expect(files![0]!.type).toBe("image/png");
    expect(files![0]!.size).toBe(9);
    // A second reader (another mounted ChatView in a split) must not
    // duplicate the drop: the event is claimed by the first read.
    expect(readLatticeComposerFilesMessage(event, config)).toBeNull();

    expect(
      readLatticeComposerFilesMessage(
        {
          source: window.parent,
          origin: "https://untrusted.example",
          data: validData,
        } as MessageEvent,
        config,
      ),
    ).toBeNull();
    expect(
      readLatticeComposerFilesMessage(
        {
          source: window.parent,
          origin: "http://localhost:1420",
          data: {
            type: LATTICE_COMPOSER_FILES,
            version: 1,
            files: [{ name: "../evil.png", mimeType: "image/png", bytes }],
          },
        } as MessageEvent,
        config,
      ),
    ).toBeNull();
  });

  it("treats host pointer reports as the missing iframe pointerleave", () => {
    installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode()!;
    expect(
      readLatticeHostPointerMessage(
        {
          source: window.parent,
          origin: "http://localhost:1420",
          data: { type: LATTICE_HOST_POINTER },
        } as MessageEvent,
        config,
      ),
    ).toBe(true);
    expect(
      readLatticeHostPointerMessage(
        {
          source: window.parent,
          origin: "https://untrusted.example",
          data: { type: LATTICE_HOST_POINTER },
        } as MessageEvent,
        config,
      ),
    ).toBe(false);
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

    expect(
      readLatticeHostContextMessage(
        {
          source: window.parent,
          origin: "http://localhost:1420",
          data: context,
        } as MessageEvent,
        config,
      ),
    ).toEqual(context);
    expect(
      readLatticeHostContextMessage(
        {
          source: window.parent,
          origin: "http://localhost:1420",
          data: { ...context, workspaceRoot: "/Users/me/other" },
        } as MessageEvent,
        config,
      ),
    ).toBeNull();

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

  it("accepts a bounded paper library from the configured Lattice workspace", () => {
    const { postMessage } = installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode()!;
    const library = {
      type: LATTICE_PAPER_LIBRARY,
      version: 1,
      workspaceRoot: "/Users/me/paper/",
      papers: [
        {
          title: "Attention Is All You Need",
          arxivId: "1706.03762",
          citationKey: "vaswani2017attention",
          path: ".research/papers/1706.03762/paper.md",
          view: "fulltext",
        },
      ],
    };

    expect(
      readLatticePaperLibraryMessage(
        {
          source: window.parent,
          origin: "http://localhost:1420",
          data: library,
        } as MessageEvent,
        config,
      ),
    ).toEqual(library);
    expect(
      readLatticePaperLibraryMessage(
        {
          source: window.parent,
          origin: "http://localhost:1420",
          data: {
            ...library,
            papers: [{ ...library.papers[0], path: "../../secrets.txt" }],
          },
        } as MessageEvent,
        config,
      ),
    ).toBeNull();
    expect(
      readLatticePaperLibraryMessage(
        {
          source: window.parent,
          origin: "http://malicious.example",
          data: library,
        } as MessageEvent,
        config,
      ),
    ).toBeNull();

    postPaperLibraryRequestToLattice(config);
    expect(postMessage).toHaveBeenCalledWith(
      { type: LATTICE_PAPER_LIBRARY_REQUEST },
      "http://localhost:1420",
    );
  });

  it("accepts panel-open events only from the configured Lattice host", () => {
    installBrowserStubs();
    initializeEmbedMode();
    const config = readEmbedMode()!;

    expect(
      readLatticeAgentPanelOpenedMessage(
        {
          source: window.parent,
          origin: "http://localhost:1420",
          data: { type: LATTICE_AGENT_PANEL_OPENED },
        } as MessageEvent,
        config,
      ),
    ).toBe(true);
    expect(
      readLatticeAgentPanelOpenedMessage(
        {
          source: window.parent,
          origin: "http://malicious.example",
          data: { type: LATTICE_AGENT_PANEL_OPENED },
        } as MessageEvent,
        config,
      ),
    ).toBe(false);
  });
});

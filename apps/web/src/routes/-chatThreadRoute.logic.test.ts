import { ProjectId, ThreadId, TurnId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  collectParentDirectoryPaths,
  normalizeSingleSearchFromPane,
  resolveEmbeddedDraftProjectRebind,
  resolveEmbeddedForeignThreadReturnTarget,
  resolveEmbeddedThreadRoute,
  resolveFilePreviewWorkspaceRoot,
  resolveRoutePanelBootstrap,
  resolveSingleProjectId,
  resolveSplitPaneCloseDecision,
  resolveThreadPickerTitle,
  resolveToggledChatPanelPatch,
  stripEditorViewSearchParams,
} from "./-chatThreadRoute.logic";

const THREAD_ID = ThreadId.makeUnsafe("thread-1");
const SIDECHAT_THREAD_ID = ThreadId.makeUnsafe("thread-sidechat");
const OTHER_THREAD_ID = ThreadId.makeUnsafe("thread-2");
const TURN_ID = TurnId.makeUnsafe("turn-1");
const OTHER_TURN_ID = TurnId.makeUnsafe("turn-2");
const PROJECT_ID = ProjectId.makeUnsafe("project-1");
const DRAFT_PROJECT_ID = ProjectId.makeUnsafe("project-draft");

describe("resolveThreadPickerTitle", () => {
  it("falls back to a stable untitled label", () => {
    expect(resolveThreadPickerTitle(null)).toBe("New chat");
    expect(resolveThreadPickerTitle("")).toBe("New chat");
  });

  it("preserves non-empty thread titles", () => {
    expect(resolveThreadPickerTitle("Bug bash")).toBe("Bug bash");
  });
});

describe("resolveFilePreviewWorkspaceRoot", () => {
  it("uses the project cwd for local threads", () => {
    expect(
      resolveFilePreviewWorkspaceRoot({
        projectCwd: "/repo/project",
        threadEnvMode: "local",
        threadWorktreePath: null,
      }),
    ).toBe("/repo/project");
  });

  it("uses a Studio thread working directory ahead of its container project", () => {
    expect(
      resolveFilePreviewWorkspaceRoot({
        projectCwd: "/synara/studio",
        threadEnvMode: "local",
        threadWorktreePath: null,
        threadWorkingDirectory: "/repo/external",
      }),
    ).toBe("/repo/external");
  });

  it("uses the materialized worktree for worktree-backed threads", () => {
    expect(
      resolveFilePreviewWorkspaceRoot({
        projectCwd: "/repo/project",
        threadEnvMode: "worktree",
        threadWorktreePath: "/repo/.worktrees/feature",
      }),
    ).toBe("/repo/.worktrees/feature");
  });

  it("does not fall back to the project cwd while a worktree is still pending", () => {
    expect(
      resolveFilePreviewWorkspaceRoot({
        projectCwd: "/repo/project",
        threadEnvMode: "worktree",
        threadWorktreePath: null,
      }),
    ).toBeNull();
  });
});

describe("single chat route helpers", () => {
  it("prefers the server thread project and falls back to the draft project", () => {
    expect(
      resolveSingleProjectId({
        threadProjectId: PROJECT_ID,
        draftProjectId: DRAFT_PROJECT_ID,
      }),
    ).toBe(PROJECT_ID);
    expect(
      resolveSingleProjectId({
        threadProjectId: null,
        draftProjectId: DRAFT_PROJECT_ID,
      }),
    ).toBe(DRAFT_PROJECT_ID);
    expect(resolveSingleProjectId({ threadProjectId: null, draftProjectId: null })).toBeNull();
  });

  it("rebinds a stale embedded draft to the canonical workspace project", () => {
    expect(
      resolveEmbeddedDraftProjectRebind({
        draftProjectId: DRAFT_PROJECT_ID,
        embeddedProjectId: PROJECT_ID,
      }),
    ).toBe(PROJECT_ID);
    expect(
      resolveEmbeddedDraftProjectRebind({
        draftProjectId: PROJECT_ID,
        embeddedProjectId: PROJECT_ID,
      }),
    ).toBeNull();
    expect(
      resolveEmbeddedDraftProjectRebind({
        draftProjectId: DRAFT_PROJECT_ID,
        embeddedProjectId: null,
      }),
    ).toBeNull();
  });

  it("normalizes split pane browser and diff state for single-chat navigation", () => {
    expect(
      normalizeSingleSearchFromPane({
        panel: "browser",
        diffTurnId: TURN_ID,
        diffFilePath: "src/ignored.tsx",
      }),
    ).toEqual({ panel: "browser" });
    expect(
      normalizeSingleSearchFromPane({
        panel: "diff",
        diffTurnId: TURN_ID,
        diffFilePath: "src/chat.tsx",
      }),
    ).toEqual({
      panel: "diff",
      diff: "1",
      diffTurnId: TURN_ID,
      diffFilePath: "src/chat.tsx",
    });
    expect(
      normalizeSingleSearchFromPane({
        panel: null,
        diffTurnId: TURN_ID,
        diffFilePath: "src/chat.tsx",
      }),
    ).toEqual({});
  });

  it("strips only editor-owned search fields", () => {
    expect(
      stripEditorViewSearchParams({
        view: "editor",
        editorFilePath: "src/chat.tsx",
        splitViewId: "split-1",
        q: "keep",
      }),
    ).toEqual({ splitViewId: "split-1", q: "keep" });
  });

  it("collects workspace-relative parent directories from shallow to deep", () => {
    expect(collectParentDirectoryPaths("src/components/chat/View.tsx")).toEqual([
      "src",
      "src/components",
      "src/components/chat",
    ]);
    expect(collectParentDirectoryPaths("View.tsx")).toEqual([]);
    expect(collectParentDirectoryPaths("/src//chat/View.tsx")).toEqual(["src", "src/chat"]);
  });
});

describe("resolveEmbeddedThreadRoute", () => {
  const EMBEDDED = ProjectId.makeUnsafe("project-alpha");
  const FOREIGN = ProjectId.makeUnsafe("project-beta");
  const OWN_THREAD = ThreadId.makeUnsafe("thread-alpha");
  const FOREIGN_THREAD = ThreadId.makeUnsafe("thread-beta-1");
  const OTHER_FOREIGN_THREAD = ThreadId.makeUnsafe("thread-beta-2");
  type Input = Parameters<typeof resolveEmbeddedThreadRoute>[0];
  const onThread = (
    threadId: ThreadId,
    threadProjectId: ProjectId | null,
    redirectedFromThreadId: ThreadId | null,
    overrides: Partial<Input> = {},
  ) =>
    resolveEmbeddedThreadRoute({
      embeddedProjectId: EMBEDDED,
      threadsHydrated: true,
      threadId,
      threadProjectId,
      draft: null,
      redirectedFromThreadId,
      ...overrides,
    });

  it("leaves another project's thread", () => {
    expect(onThread(FOREIGN_THREAD, FOREIGN, null)).toEqual({
      kind: "leave",
      redirectedFromThreadId: FOREIGN_THREAD,
    });
  });

  it("does not leave the same thread twice within one visit", () => {
    const first = onThread(FOREIGN_THREAD, FOREIGN, null);
    expect(onThread(FOREIGN_THREAD, FOREIGN, first.redirectedFromThreadId)).toEqual({
      kind: "left",
      redirectedFromThreadId: FOREIGN_THREAD,
    });
  });

  it("leaves a second foreign thread reached straight from the first", () => {
    const first = onThread(FOREIGN_THREAD, FOREIGN, null);
    expect(onThread(OTHER_FOREIGN_THREAD, FOREIGN, first.redirectedFromThreadId)).toEqual({
      kind: "leave",
      redirectedFromThreadId: OTHER_FOREIGN_THREAD,
    });
  });

  // The shipped bug: a one-shot guard skipped every foreign thread after the first.
  it("leaves the same foreign thread again after an own-project route", () => {
    const first = onThread(FOREIGN_THREAD, FOREIGN, null);
    const own = onThread(OWN_THREAD, EMBEDDED, first.redirectedFromThreadId);
    expect(own).toEqual({
      kind: "own",
      rebindDraftToProjectId: null,
      redirectedFromThreadId: null,
    });
    expect(onThread(FOREIGN_THREAD, FOREIGN, own.redirectedFromThreadId).kind).toBe("leave");
  });

  it("clears the guard on an own-project draft", () => {
    const draftThread = ThreadId.makeUnsafe("draft-alpha");
    expect(onThread(draftThread, null, FOREIGN_THREAD, { draft: { projectId: EMBEDDED } })).toEqual(
      { kind: "own", rebindDraftToProjectId: null, redirectedFromThreadId: null },
    );
  });

  it("moves another project's draft onto the frame's project instead of leaving it", () => {
    const draftThread = ThreadId.makeUnsafe("draft-beta");
    expect(onThread(draftThread, null, null, { draft: { projectId: FOREIGN } })).toEqual({
      kind: "own",
      rebindDraftToProjectId: EMBEDDED,
      redirectedFromThreadId: null,
    });
  });

  it("judges a server thread by its own project even when a draft entry remains", () => {
    expect(onThread(FOREIGN_THREAD, FOREIGN, null, { draft: { projectId: EMBEDDED } }).kind).toBe(
      "leave",
    );
  });

  it("waits while the thread's project is unknown", () => {
    expect(onThread(FOREIGN_THREAD, null, null)).toEqual({
      kind: "idle",
      redirectedFromThreadId: null,
    });
    expect(onThread(FOREIGN_THREAD, FOREIGN, null, { threadsHydrated: false })).toEqual({
      kind: "idle",
      redirectedFromThreadId: null,
    });
    // Waiting keeps the guard, so a thread the frame already left is not left twice.
    expect(onThread(FOREIGN_THREAD, null, FOREIGN_THREAD).redirectedFromThreadId).toBe(
      FOREIGN_THREAD,
    );
  });

  it("waits until the frame's project is bound", () => {
    expect(onThread(FOREIGN_THREAD, FOREIGN, null, { embeddedProjectId: null }).kind).toBe("idle");
  });
});

describe("resolveEmbeddedForeignThreadReturnTarget", () => {
  const LAST = ThreadId.makeUnsafe("thread-last");
  const RECENT = ThreadId.makeUnsafe("thread-recent");

  it("returns to the frame's last own thread while it can still be opened", () => {
    expect(
      resolveEmbeddedForeignThreadReturnTarget({
        lastOwnThreadId: LAST,
        isOpenableOwnThread: (threadId) => threadId === LAST,
        recentOwnThreadIds: [RECENT],
      }),
    ).toBe(LAST);
  });

  it("falls back to the project's most recent thread", () => {
    expect(
      resolveEmbeddedForeignThreadReturnTarget({
        lastOwnThreadId: LAST,
        isOpenableOwnThread: () => false,
        recentOwnThreadIds: [RECENT, LAST],
      }),
    ).toBe(RECENT);
    expect(
      resolveEmbeddedForeignThreadReturnTarget({
        lastOwnThreadId: null,
        isOpenableOwnThread: () => true,
        recentOwnThreadIds: [RECENT],
      }),
    ).toBe(RECENT);
  });

  it("has no target when the project has no thread", () => {
    expect(
      resolveEmbeddedForeignThreadReturnTarget({
        lastOwnThreadId: null,
        isOpenableOwnThread: () => true,
        recentOwnThreadIds: [],
      }),
    ).toBeNull();
  });
});

describe("resolveRoutePanelBootstrap", () => {
  it("hydrates diff deep links exactly once per scope and search payload", () => {
    const first = resolveRoutePanelBootstrap({
      scopeId: "thread-1",
      search: {
        panel: "diff",
        diff: "1",
        diffTurnId: TURN_ID,
        diffFilePath: "src/chat.tsx",
      },
      lastAppliedSearchKey: null,
    });

    expect(first.panelPatch).toEqual({
      panel: "diff",
      diffTurnId: TURN_ID,
      diffFilePath: "src/chat.tsx",
    });
    expect(first.nextAppliedSearchKey).toEqual(expect.any(String));

    const duplicate = resolveRoutePanelBootstrap({
      scopeId: "thread-1",
      search: {
        panel: "diff",
        diff: "1",
        diffTurnId: TURN_ID,
        diffFilePath: "src/chat.tsx",
      },
      lastAppliedSearchKey: first.nextAppliedSearchKey,
    });

    expect(duplicate).toEqual({
      nextAppliedSearchKey: first.nextAppliedSearchKey,
      panelPatch: null,
    });
  });

  it("resets once route search params are stripped so the same deep link can replay", () => {
    const first = resolveRoutePanelBootstrap({
      scopeId: "thread-1",
      search: {
        panel: "diff",
        diff: "1",
        diffTurnId: TURN_ID,
        diffFilePath: "src/chat.tsx",
      },
      lastAppliedSearchKey: null,
    });

    const cleared = resolveRoutePanelBootstrap({
      scopeId: "thread-1",
      search: {},
      lastAppliedSearchKey: first.nextAppliedSearchKey,
    });

    expect(cleared).toEqual({
      nextAppliedSearchKey: null,
      panelPatch: null,
    });

    const replay = resolveRoutePanelBootstrap({
      scopeId: "thread-1",
      search: {
        panel: "diff",
        diff: "1",
        diffTurnId: TURN_ID,
        diffFilePath: "src/chat.tsx",
      },
      lastAppliedSearchKey: cleared.nextAppliedSearchKey,
    });

    expect(replay.panelPatch).toEqual({
      panel: "diff",
      diffTurnId: TURN_ID,
      diffFilePath: "src/chat.tsx",
    });
  });

  it("reapplies the same deep link when the mounted thread scope changes", () => {
    const first = resolveRoutePanelBootstrap({
      scopeId: "thread-1",
      search: {
        panel: "diff",
        diff: "1",
        diffTurnId: TURN_ID,
      },
      lastAppliedSearchKey: null,
    });

    const nextThread = resolveRoutePanelBootstrap({
      scopeId: "thread-2",
      search: {
        panel: "diff",
        diff: "1",
        diffTurnId: TURN_ID,
      },
      lastAppliedSearchKey: first.nextAppliedSearchKey,
    });

    expect(nextThread.panelPatch).toEqual({
      panel: "diff",
      diffTurnId: TURN_ID,
      diffFilePath: null,
    });
  });
});

describe("resolveToggledChatPanelPatch", () => {
  it("preserves the last diff target when switching from diff to browser", () => {
    expect(
      resolveToggledChatPanelPatch(
        {
          panel: "diff",
          diffTurnId: TURN_ID,
          diffFilePath: "src/chat.tsx",
        },
        "browser",
      ),
    ).toEqual({
      panel: "browser",
      diffTurnId: TURN_ID,
      diffFilePath: "src/chat.tsx",
    });
  });

  it("keeps diff context even when closing the browser panel", () => {
    expect(
      resolveToggledChatPanelPatch(
        {
          panel: "browser",
          diffTurnId: OTHER_TURN_ID,
          diffFilePath: "src/browser.tsx",
        },
        "browser",
      ),
    ).toEqual({
      panel: null,
      diffTurnId: OTHER_TURN_ID,
      diffFilePath: "src/browser.tsx",
    });
  });
});

describe("resolveSplitPaneCloseDecision", () => {
  it("returns to the original thread when closing a sidechat pane", () => {
    expect(
      resolveSplitPaneCloseDecision({
        splitViewId: "split-sidechat",
        sourceThreadId: THREAD_ID,
        closingThreadId: SIDECHAT_THREAD_ID,
        closingSidechatSourceThreadId: THREAD_ID,
        nextFocusedThreadId: SIDECHAT_THREAD_ID,
        nextLeafCount: 1,
      }),
    ).toEqual({
      kind: "single-thread",
      threadId: THREAD_ID,
      splitViewIdToRemove: "split-sidechat",
    });
  });

  it("collapses a generic one-pane remainder to single chat", () => {
    expect(
      resolveSplitPaneCloseDecision({
        splitViewId: "split-1",
        sourceThreadId: THREAD_ID,
        closingThreadId: THREAD_ID,
        closingSidechatSourceThreadId: null,
        nextFocusedThreadId: OTHER_THREAD_ID,
        nextLeafCount: 1,
      }),
    ).toEqual({
      kind: "single-thread",
      threadId: OTHER_THREAD_ID,
      splitViewIdToRemove: "split-1",
    });
  });

  it("keeps a multi-pane split when there are still multiple leaves", () => {
    expect(
      resolveSplitPaneCloseDecision({
        splitViewId: "split-1",
        sourceThreadId: THREAD_ID,
        closingThreadId: THREAD_ID,
        closingSidechatSourceThreadId: null,
        nextFocusedThreadId: OTHER_THREAD_ID,
        nextLeafCount: 2,
      }),
    ).toEqual({
      kind: "split-thread",
      threadId: OTHER_THREAD_ID,
      splitViewId: "split-1",
    });
  });
});

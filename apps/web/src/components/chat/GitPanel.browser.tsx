// FILE: GitPanel.browser.tsx
// Purpose: Browser regressions for the embedded Source Control pane.
// Layer: Browser UI test

import "../../index.css";

import { I18nProvider } from "@lingui/react";
import type { GitBranchPullRequest, GitStatusResult, NativeApi } from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { i18n } from "../../i18n";
import { GitPanel } from "./GitPanel";
import { useAppTypography } from "../../hooks/useAppTypography";

const TEST_CWD = "/tmp/research-writer";
i18n.loadAndActivate({ locale: "en", messages: {} });

function buildLongPatch(lineCount = 80): string {
  return [
    "diff --git a/src/long.ts b/src/long.ts",
    "index 1111111..2222222 100644",
    "--- a/src/long.ts",
    "+++ b/src/long.ts",
    `@@ -1,${lineCount} +1,${lineCount} @@`,
    ...Array.from(
      { length: lineCount },
      (_, index) =>
        `-const oldValue${index + 1}WithANameThatMustRemainUnwrapped${"AndKeepsGoing".repeat(12)} = ${index + 1};`,
    ),
    ...Array.from(
      { length: lineCount },
      (_, index) =>
        `+const newValue${index + 1}WithANameThatMustRemainUnwrapped${"AndKeepsGoing".repeat(12)} = ${index + 1};`,
    ),
    "",
  ].join("\n");
}

function gitStatus(branch: string, hasWorkingTreeChanges = true, aheadCount = 0): GitStatusResult {
  return {
    branch,
    hasWorkingTreeChanges,
    workingTree: {
      files: hasWorkingTreeChanges ? [{ path: "src/long.ts", insertions: 80, deletions: 80 }] : [],
      insertions: hasWorkingTreeChanges ? 80 : 0,
      deletions: hasWorkingTreeChanges ? 80 : 0,
    },
    hasUpstream: true,
    upstreamBranch: branch,
    aheadCount,
    behindCount: 0,
  };
}

function installGitApi(
  options: {
    branch?: string;
    hasWorkingTreeChanges?: boolean;
    aheadCount?: number;
    refreshGate?: Promise<void>;
    statusGate?: Promise<void>;
    branchesGate?: Promise<void>;
    pullRequestGate?: Promise<void>;
    pullRequest?: GitBranchPullRequest;
  } = {},
) {
  const hasWorkingTreeChanges = options.hasWorkingTreeChanges ?? true;
  const aheadCount = options.aheadCount ?? 0;
  let currentBranch = options.branch ?? "feature/source-control";
  let branchReadCount = 0;
  const checkoutCalls: string[] = [];
  const actionCalls: Array<{ action: string; filePaths?: string[] }> = [];
  const readCalls: string[] = [];
  const openedUrls: string[] = [];
  let resolvedPullRequests = 0;
  const patch = hasWorkingTreeChanges ? buildLongPatch() : "";

  window.nativeApi = {
    git: {
      listBranches: async () => {
        readCalls.push("listBranches");
        branchReadCount += 1;
        if (branchReadCount === 1) {
          await options.branchesGate;
        }
        if (branchReadCount > 1 && options.refreshGate) {
          await options.refreshGate;
        }
        return {
          branches: [
            {
              name: "main",
              current: currentBranch === "main",
              isDefault: true,
              worktreePath: null,
            },
            {
              name: "feature/source-control",
              current: currentBranch === "feature/source-control",
              isDefault: false,
              worktreePath: null,
            },
          ],
          isRepo: true,
          hasOriginRemote: true,
        };
      },
      status: async () => {
        readCalls.push("status");
        await options.statusGate;
        return gitStatus(currentBranch, hasWorkingTreeChanges, aheadCount);
      },
      branchPullRequest: async () => {
        readCalls.push("branchPullRequest");
        await options.pullRequestGate;
        resolvedPullRequests += 1;
        return { branch: currentBranch, pr: options.pullRequest ?? null };
      },
      readWorkingTreeDiff: async ({ scope }: { scope?: string }) => {
        readCalls.push(`readWorkingTreeDiff:${scope ?? "workingTree"}`);
        return { patch: scope === "staged" ? "" : patch };
      },
      checkout: async ({ branch }: { branch: string }) => {
        checkoutCalls.push(branch);
        currentBranch = branch;
      },
      runStackedAction: async (input: { action: string; filePaths?: string[] }) => {
        actionCalls.push(input);
        return {
          action: input.action,
          branch: { status: "skipped_not_requested" },
          commit: {
            status: "created",
            commitSha: "0123456789abcdef",
            subject: "fix: improve source control interactions",
          },
          push: {
            status: "pushed",
            branch: currentBranch,
            upstreamBranch: `origin/${currentBranch}`,
          },
          pr: { status: "skipped_not_requested" },
        };
      },
      onActionProgress: () => () => undefined,
    },
    shell: {
      openExternal: async (url: string) => {
        openedUrls.push(url);
      },
    },
    server: {
      getSettings: () => new Promise(() => undefined),
    },
  } as unknown as NativeApi;

  return {
    actionCalls,
    checkoutCalls,
    readCalls,
    openedUrls,
    get resolvedPullRequests() {
      return resolvedPullRequests;
    },
  };
}

function Typography() {
  useAppTypography();
  return null;
}

function renderWithQueryClient(element: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <Typography />
        <div className="h-[420px] w-[360px] bg-background text-foreground">{element}</div>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe("GitPanel", () => {
  afterEach(() => {
    delete window.nativeApi;
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  it("keeps a long selected-file diff on one wheel-scrollable viewport with fixed scrollbars", async () => {
    installGitApi();
    await renderWithQueryClient(
      <GitPanel hostThreadId={null} projectId={null} cwdOverride={TEST_CWD} title="Changes" />,
    );

    await page.getByRole("button", { name: /src\/long\.ts/ }).click();
    await expect.element(page.getByText("Rendering diff…")).not.toBeInTheDocument();

    const scrollArea = document.querySelector<HTMLElement>("[data-git-diff-scroll]");
    const scrollViewport = scrollArea?.querySelector<HTMLElement>(
      ':scope > [data-slot="scroll-area-viewport"]',
    );
    const diffHost = scrollViewport?.querySelector<HTMLElement>("diffs-container");
    const innerCodeViewport = diffHost?.shadowRoot?.querySelector<HTMLElement>("[data-code]");
    expect(scrollArea).not.toBeNull();
    expect(scrollViewport).not.toBeNull();
    expect(innerCodeViewport).not.toBeNull();
    await expect
      .poll(() => scrollArea!.querySelector(':scope > [data-orientation="vertical"]'))
      .not.toBeNull();
    await expect
      .poll(() => scrollArea!.querySelector(':scope > [data-orientation="horizontal"]'))
      .not.toBeNull();
    const verticalScrollbar = scrollArea!.querySelector<HTMLElement>(
      ':scope > [data-orientation="vertical"]',
    );
    const horizontalScrollbar = scrollArea!.querySelector<HTMLElement>(
      ':scope > [data-orientation="horizontal"]',
    );
    expect(verticalScrollbar).not.toBeNull();
    expect(horizontalScrollbar).not.toBeNull();
    expect(getComputedStyle(scrollViewport!).overflowY).toBe("scroll");
    expect(getComputedStyle(innerCodeViewport!).overflowX).toBe("visible");
    expect(scrollViewport!.scrollHeight).toBeGreaterThan(scrollViewport!.clientHeight);
    expect(scrollViewport!.scrollWidth).toBeGreaterThan(scrollViewport!.clientWidth);

    const initialScrollbarBottom = horizontalScrollbar!.getBoundingClientRect().bottom;
    expect(
      Math.abs(initialScrollbarBottom - scrollArea!.getBoundingClientRect().bottom),
    ).toBeLessThan(1);

    await userEvent.hover(scrollArea!);
    await expect.poll(() => getComputedStyle(verticalScrollbar!).opacity).toBe("1");
    await expect.poll(() => getComputedStyle(horizontalScrollbar!).opacity).toBe("1");

    await userEvent.wheel(scrollArea!, { delta: { y: 180 } });
    await expect.poll(() => scrollViewport!.scrollTop).toBeGreaterThan(0);
    expect(horizontalScrollbar!.getBoundingClientRect().bottom).toBe(initialScrollbarBottom);

    await userEvent.wheel(scrollArea!, { delta: { x: 180 } });
    await expect.poll(() => scrollViewport!.scrollLeft).toBeGreaterThan(0);
  });

  it("composes the commit message in the panel and commits with Commit & push", async () => {
    const { actionCalls } = installGitApi();
    await renderWithQueryClient(
      <GitPanel
        hostThreadId={null}
        projectId={null}
        cwdOverride={TEST_CWD}
        showActions
        title="Changes"
      />,
    );

    const commitAndPush = page.getByRole("button", { name: /^Commit & push 1 file/ });
    const moreActions = page.getByRole("button", { name: "More Git actions" });
    await expect.element(commitAndPush).toBeEnabled();
    await expect.element(moreActions).toHaveAttribute("aria-expanded", "false");
    await expect.element(page.getByText("Up to date", { exact: true })).toBeVisible();

    const branchTrigger = document.querySelector<HTMLElement>('[data-slot="combobox-trigger"]');
    const branchBar = document.querySelector<HTMLElement>("[data-lattice-git-branchbar]");
    expect(branchTrigger).not.toBeNull();
    expect(branchBar?.contains(branchTrigger)).toBe(true);

    await moreActions.click();
    await expect.element(moreActions).toHaveAttribute("aria-expanded", "true");
    await expect.element(page.getByText("Git actions", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Escape}");

    await page.getByRole("textbox", { name: "Commit message" }).fill("Tighten the long file");
    await commitAndPush.click();
    await expect.poll(() => actionCalls.length).toBe(1);
    expect(actionCalls[0]).toMatchObject({
      action: "commit_push",
      commitMessage: "Tighten the long file",
    });
    expect(actionCalls[0]?.filePaths).toBeUndefined();
  });

  it.each([
    { locale: "en", hasWorkingTreeChanges: true },
    { locale: "en", hasWorkingTreeChanges: false },
    { locale: "zh-CN", hasWorkingTreeChanges: true },
    { locale: "zh-CN", hasWorkingTreeChanges: false },
  ])(
    "keeps the $locale default-branch confirmation compact and dismissible (changes: $hasWorkingTreeChanges)",
    async ({ locale, hasWorkingTreeChanges }) => {
      const { actionCalls } = installGitApi({
        branch: "main",
        aheadCount: 1,
        hasWorkingTreeChanges,
      });
      if (locale === "zh-CN") {
        const { messages } = await import("../../locales/zh-CN/messages.po");
        i18n.loadAndActivate({ locale, messages });
      }
      await page.viewport(480, 720);
      await renderWithQueryClient(
        <GitPanel
          hostThreadId={null}
          projectId={null}
          cwdOverride={TEST_CWD}
          showActions
          title="Changes"
        />,
      );

      // With changes the composer commits and pushes; clean, the push waits in the clean state.
      const openConfirmation = () =>
        (hasWorkingTreeChanges
          ? page.getByRole("button", {
              name: new RegExp(
                `^${i18n._("{count, plural, one {Commit & push # file} other {Commit & push # files}}", { count: 1 })}`,
              ),
            })
          : page.getByRole("button", {
              name: i18n._("{count, plural, one {Push # commit} other {Push # commits}}", {
                count: 1,
              }),
              exact: true,
            })
        ).click();
      await openConfirmation();
      await expect.element(page.getByRole("dialog")).toBeVisible();
      const popup = document.querySelector<HTMLElement>('[data-slot="dialog-popup"]')!;
      const description = popup.querySelector<HTMLElement>('[data-slot="dialog-description"]')!;
      expect(getComputedStyle(description).fontSize).toBe(
        getComputedStyle(document.documentElement).getPropertyValue("--app-font-size-ui-xs").trim(),
      );
      expect(popup.getBoundingClientRect().width).toBeLessThanOrEqual(448);
      expect(popup.getBoundingClientRect().height).toBeLessThan(260);
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      await page.screenshot();
      await page.getByRole("button", { name: i18n._("Close"), exact: true }).click();
      await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();

      await openConfirmation();
      await userEvent.keyboard("{Escape}");
      await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();

      await openConfirmation();
      await page.getByRole("button", { name: i18n._("Abort"), exact: true }).click();
      await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
      expect(actionCalls).toEqual([]);
      await page.viewport(1280, 720);
    },
  );

  it("shows the target branch and editable message in the commit dialog", async () => {
    installGitApi();
    await renderWithQueryClient(
      <GitPanel
        hostThreadId={null}
        projectId={null}
        cwdOverride={TEST_CWD}
        showActions
        title="Changes"
      />,
    );

    await page.getByRole("button", { name: "More Git actions" }).click();
    await page.getByRole("menuitem", { name: "Commit", exact: true }).click();

    const description = document.querySelector<HTMLElement>('[data-slot="dialog-description"]');
    expect(description).not.toBeNull();
    expect(description!.textContent).toBe("feature/source-control");
    expect(getComputedStyle(description!).fontSize).toBe("14px");
    await expect.element(page.getByRole("textbox", { name: "Commit message" })).toBeVisible();
  });

  it("shows the source branch, base branch and editable title for Create PR", async () => {
    installGitApi();
    await renderWithQueryClient(
      <GitPanel
        hostThreadId={null}
        projectId={null}
        cwdOverride={TEST_CWD}
        showActions
        title="Changes"
      />,
    );

    await page.getByRole("button", { name: "More Git actions" }).click();
    await page.getByRole("menuitem", { name: "Create PR", exact: true }).click();

    await expect.element(page.getByRole("heading", { name: "Branch → main" })).toBeVisible();
    const description = document.querySelector<HTMLElement>('[data-slot="dialog-description"]');
    expect(description).not.toBeNull();
    expect(description!.textContent).toBe("feature/source-control");
    expect(getComputedStyle(description!).fontSize).toBe("14px");
    await expect.element(page.getByRole("textbox", { name: "Pull request title" })).toBeVisible();
    const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-popup"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("feature/source-control");
  });

  it("uses compact shared dialog styles for Create Branch", async () => {
    installGitApi();
    await renderWithQueryClient(
      <GitPanel
        hostThreadId={null}
        projectId={null}
        cwdOverride={TEST_CWD}
        showActions
        title="Changes"
      />,
    );

    await page.getByRole("button", { name: "More Git actions" }).click();
    await page.getByRole("menuitem", { name: "Create Branch", exact: true }).click();

    await expect.element(page.getByRole("heading", { name: "Create Branch" })).toBeVisible();
    const description = document.querySelector<HTMLElement>('[data-slot="dialog-description"]');
    const branchNameInput = document.querySelector<HTMLElement>(
      '[data-slot="input-control"][data-size="sm"]',
    );
    expect(description).not.toBeNull();
    expect(branchNameInput).not.toBeNull();
    expect(getComputedStyle(description!).fontSize).toBe(
      getComputedStyle(document.documentElement).getPropertyValue("--app-font-size-ui-xs").trim(),
    );
    expect(getComputedStyle(description!).lineHeight).toBe("16px");
    expect(getComputedStyle(branchNameInput!).height).toBe("28px");
  });

  it("spins the Changes refresh icon only while a manual refresh is pending", async () => {
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    installGitApi({ refreshGate });
    await renderWithQueryClient(
      <GitPanel hostThreadId={null} projectId={null} cwdOverride={TEST_CWD} title="Changes" />,
    );

    const refreshButton = page.getByRole("button", { name: "Refresh changes" });
    await expect.element(refreshButton).toBeEnabled();
    await refreshButton.click();

    await expect.element(refreshButton).toHaveAttribute("aria-busy", "true");
    expect(refreshButton.element().querySelector(".animate-spin")).not.toBeNull();

    releaseRefresh();
    await expect.poll(() => refreshButton.element().getAttribute("aria-busy")).toBeNull();
    expect(refreshButton.element().querySelector(".animate-spin")).toBeNull();
  });

  it("says everything is committed and offers no commit action when clean", async () => {
    installGitApi({ hasWorkingTreeChanges: false });
    await renderWithQueryClient(
      <GitPanel
        hostThreadId={null}
        projectId={null}
        cwdOverride={TEST_CWD}
        showActions
        title="Changes"
      />,
    );

    await expect.element(page.getByText("Everything is committed", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Edits you make show up here, ready to commit", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("Up to date", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: /^Commit & push/ }))
      .not.toBeInTheDocument();
    expect(document.querySelector('[data-kind="dated-drafts"]')).not.toBeNull();
  });

  it("waits for remote status before showing the clean state and Git actions", async () => {
    let releaseStatus!: () => void;
    const statusGate = new Promise<void>((resolve) => {
      releaseStatus = resolve;
    });
    installGitApi({ hasWorkingTreeChanges: false, aheadCount: 86, statusGate });
    await renderWithQueryClient(
      <GitPanel projectId={null} cwdOverride={TEST_CWD} showActions title="Changes" />,
    );
    try {
      await expect.element(page.getByRole("status", { name: "Loading changes..." })).toBeVisible();
      await expect
        .element(page.getByText("Everything is committed", { exact: true }))
        .not.toBeInTheDocument();
      await expect.element(page.getByRole("button", { name: "More Git actions" })).toBeDisabled();
      await page.screenshot();
    } finally {
      releaseStatus();
    }
    await expect
      .element(
        page.getByText(
          "86 commits are waiting to go to origin. Push them when you are ready to share them",
          { exact: true },
        ),
      )
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Push 86 commits" })).toBeEnabled();
    await expect.element(page.getByRole("button", { name: "More Git actions" })).toBeEnabled();
    await page.screenshot();
  });

  it("starts status and diff reads alongside the repository probe", async () => {
    let releaseBranches!: () => void;
    const branchesGate = new Promise<void>((resolve) => {
      releaseBranches = resolve;
    });
    const { readCalls } = installGitApi({ branchesGate });
    await renderWithQueryClient(
      <GitPanel projectId={null} cwdOverride={TEST_CWD} showActions title="Changes" />,
    );
    try {
      await expect
        .poll(() => [...readCalls].toSorted())
        .toEqual([
          "listBranches",
          "readWorkingTreeDiff:staged",
          "readWorkingTreeDiff:unstaged",
          "status",
        ]);
      // The changed files render before the branch list answers; only the commit
      // button waits for the status it commits against.
      await expect.element(page.getByRole("button", { name: /src\/long\.ts/ })).toBeVisible();
      await expect
        .element(page.getByRole("button", { name: /^Commit & push 1 file/ }))
        .toBeDisabled();
      await page.screenshot();
    } finally {
      releaseBranches();
    }
    await expect.element(page.getByRole("button", { name: /^Commit & push 1 file/ })).toBeEnabled();
  });

  it("shows changes and Git actions without waiting for the branch pull request", async () => {
    const { readCalls } = installGitApi({ pullRequestGate: new Promise<void>(() => undefined) });
    await renderWithQueryClient(
      <GitPanel projectId={null} cwdOverride={TEST_CWD} showActions title="Changes" />,
    );

    await expect.element(page.getByRole("button", { name: /src\/long\.ts/ })).toBeVisible();
    await expect.element(page.getByRole("button", { name: /^Commit & push 1 file/ })).toBeEnabled();
    expect(readCalls).toContain("branchPullRequest");
  });

  it("renders the clean state while the PR is pending, then surfaces the PR", async () => {
    let releasePullRequest!: () => void;
    const pullRequestGate = new Promise<void>((resolve) => {
      releasePullRequest = resolve;
    });
    const api = installGitApi({
      hasWorkingTreeChanges: false,
      pullRequestGate,
      pullRequest: {
        number: 42,
        title: "Fixture PR",
        url: "https://github.com/example/repo/pull/42",
        baseBranch: "main",
        headBranch: "feature/source-control",
        state: "open",
        isDraft: false,
        mergeability: "mergeable",
        additions: 1,
        deletions: 0,
        changedFiles: 1,
      },
    });
    await renderWithQueryClient(
      <GitPanel projectId={null} cwdOverride={TEST_CWD} showActions title="Changes" />,
    );
    try {
      await expect
        .element(page.getByText("Everything is committed", { exact: true }))
        .toBeVisible();
      await page.getByRole("button", { name: "More Git actions" }).click();
      // A clean published feature branch can still create a PR. Once an existing PR
      // arrives the fork preserves the Create PR label and changes the action to open it.
      const prAction = page.getByRole("menuitem", { name: "Create PR", exact: true });
      await expect.element(prAction).toBeVisible();
      expect(api.resolvedPullRequests).toBe(0);
      releasePullRequest();
      await expect.poll(() => api.resolvedPullRequests).toBeGreaterThan(0);
      await prAction.click();
      await expect.poll(() => api.openedUrls).toEqual(["https://github.com/example/repo/pull/42"]);
    } finally {
      releasePullRequest();
    }
  });

  it("uses one consistent clean state and reports committed work waiting to push", async () => {
    installGitApi({ hasWorkingTreeChanges: false, aheadCount: 3 });
    await renderWithQueryClient(
      <GitPanel
        hostThreadId={null}
        projectId={null}
        cwdOverride={TEST_CWD}
        showActions
        title="Changes"
      />,
    );

    await expect.element(page.getByText("Everything is committed", { exact: true })).toBeVisible();
    await expect
      .element(
        page.getByText(
          "3 commits are waiting to go to origin. Push them when you are ready to share them",
          { exact: true },
        ),
      )
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: /^Push 3\s*origin$/ })).toBeVisible();
    await expect
      .element(page.getByText("Select a file to view its diff.", { exact: true }))
      .not.toBeInTheDocument();
  });

  it("lists existing branches and checks out the selected branch", async () => {
    const { checkoutCalls } = installGitApi();
    await renderWithQueryClient(
      <GitPanel
        hostThreadId={null}
        projectId={null}
        cwdOverride={TEST_CWD}
        showActions
        title="Changes"
      />,
    );

    const branchPicker = page.getByText("feature/source-control", { exact: true });
    await expect.element(branchPicker).toBeVisible();
    await branchPicker.click();

    const popupSurface = document.querySelector<HTMLElement>(
      '[data-slot="combobox-positioner"] > span',
    );
    const searchControl = document.querySelector<HTMLElement>(
      '[data-slot="combobox-positioner"] [data-slot="input-control"]',
    );
    expect(popupSurface).not.toBeNull();
    expect(searchControl).not.toBeNull();
    expect(popupSurface!.getBoundingClientRect().width).toBeLessThanOrEqual(260);
    expect(getComputedStyle(searchControl!).height).toBe("28px");

    await page.getByRole("option", { name: /main/ }).click();

    await expect.poll(() => checkoutCalls).toEqual(["main"]);
    await expect
      .poll(() =>
        document.querySelector<HTMLElement>('[data-slot="combobox-trigger"]')?.textContent?.trim(),
      )
      .toBe("main");
  });
});

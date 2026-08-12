// FILE: GitPanel.browser.tsx
// Purpose: Browser regressions for the embedded Source Control pane.
// Layer: Browser UI test

import "../../index.css";

import type { GitStatusResult, NativeApi } from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { GitPanel } from "./GitPanel";

const TEST_CWD = "/tmp/research-writer";

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

function gitStatus(branch: string, hasWorkingTreeChanges = true): GitStatusResult {
  return {
    branch,
    hasWorkingTreeChanges,
    workingTree: {
      files: hasWorkingTreeChanges
        ? [{ path: "src/long.ts", insertions: 80, deletions: 80 }]
        : [],
      insertions: hasWorkingTreeChanges ? 80 : 0,
      deletions: hasWorkingTreeChanges ? 80 : 0,
    },
    hasUpstream: true,
    upstreamBranch: branch,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
  };
}

function installGitApi(
  options: { hasWorkingTreeChanges?: boolean; refreshGate?: Promise<void> } = {},
) {
  const hasWorkingTreeChanges = options.hasWorkingTreeChanges ?? true;
  let currentBranch = "feature/source-control";
  let branchReadCount = 0;
  const checkoutCalls: string[] = [];
  const actionCalls: Array<{ action: string; filePaths?: string[] }> = [];
  const patch = hasWorkingTreeChanges ? buildLongPatch() : "";

  window.nativeApi = {
    git: {
      listBranches: async () => {
        branchReadCount += 1;
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
      status: async () => gitStatus(currentBranch, hasWorkingTreeChanges),
      readWorkingTreeDiff: async ({ scope }: { scope?: string }) => ({
        patch: scope === "staged" ? "" : patch,
      }),
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
    server: {
      getSettings: () => new Promise(() => undefined),
    },
  } as unknown as NativeApi;

  return { actionCalls, checkoutCalls };
}

function renderWithQueryClient(element: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <div className="h-[420px] w-[360px] bg-background text-foreground">{element}</div>
    </QueryClientProvider>,
  );
}

describe("GitPanel", () => {
  afterEach(() => {
    delete window.nativeApi;
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
    expect(Math.abs(initialScrollbarBottom - scrollArea!.getBoundingClientRect().bottom)).toBeLessThan(
      1,
    );

    await userEvent.hover(scrollArea!);
    await expect.poll(() => getComputedStyle(verticalScrollbar!).opacity).toBe("1");
    await expect.poll(() => getComputedStyle(horizontalScrollbar!).opacity).toBe("1");

    await userEvent.wheel(scrollArea!, { delta: { y: 180 } });
    await expect.poll(() => scrollViewport!.scrollTop).toBeGreaterThan(0);
    expect(horizontalScrollbar!.getBoundingClientRect().bottom).toBe(initialScrollbarBottom);

    await userEvent.wheel(scrollArea!, { delta: { x: 180 } });
    await expect.poll(() => scrollViewport!.scrollLeft).toBeGreaterThan(0);
  });

  it("renders Commit and Push as a direct action with a separate, stateful options menu", async () => {
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

    const commitAndPush = page.getByRole("button", { name: "Commit and Push" });
    const moreActions = page.getByRole("button", { name: "More Git actions" });
    await expect.element(commitAndPush).toBeEnabled();
    await expect.element(moreActions).toHaveAttribute("aria-expanded", "false");

    const branchTrigger = document.querySelector<HTMLElement>('[data-slot="combobox-trigger"]');
    const commitAndPushElement = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Commit and Push"]',
    );
    const moreActionsElement = document.querySelector<HTMLButtonElement>(
      'button[aria-label="More Git actions"]',
    );
    const chevron = moreActionsElement?.querySelector<SVGElement>("svg") ?? null;
    expect(branchTrigger).not.toBeNull();
    expect(commitAndPushElement).not.toBeNull();
    expect(moreActionsElement).not.toBeNull();
    expect(chevron).not.toBeNull();
    expect(getComputedStyle(commitAndPushElement!).color).toBe(
      getComputedStyle(branchTrigger!).color,
    );
    expect(getComputedStyle(commitAndPushElement!).borderTopRightRadius).toBe("0px");
    expect(getComputedStyle(moreActionsElement!).borderTopLeftRadius).toBe("0px");
    expect(getComputedStyle(moreActionsElement!).borderLeftWidth).toBe("1px");
    const closedRotation = getComputedStyle(chevron!).rotate;

    await moreActions.click();
    await expect.element(moreActions).toHaveAttribute("aria-expanded", "true");
    await expect.element(page.getByText("Git actions", { exact: true })).toBeVisible();
    const actionAnchor = document.querySelector<HTMLElement>("[data-panel-git-actions-anchor]");
    const actionMenu = document.querySelector<HTMLElement>('[data-slot="menu-positioner"]');
    expect(actionAnchor).not.toBeNull();
    expect(actionMenu).not.toBeNull();
    expect(
      Math.abs(actionMenu!.getBoundingClientRect().left - actionAnchor!.getBoundingClientRect().left),
    ).toBeLessThan(1);
    expect(
      Math.abs(actionAnchor!.getBoundingClientRect().left - branchTrigger!.getBoundingClientRect().left),
    ).toBeLessThan(1);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const openChevron = document.querySelector<HTMLButtonElement>(
      'button[aria-label="More Git actions"]',
    )?.querySelector<SVGElement>("svg");
    expect(openChevron).not.toBeNull();
    expect(getComputedStyle(openChevron!).rotate).not.toBe(closedRotation);

    await moreActions.click();
    await commitAndPush.click();
    await expect.poll(() => actionCalls.length).toBe(1);
    expect(actionCalls[0]).toMatchObject({ action: "commit_push" });
    expect(actionCalls[0]?.filePaths).toBeUndefined();
  });

  it("uses compact secondary copy in the commit dialog", async () => {
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
    expect(getComputedStyle(description!).fontSize).toBe("12px");
    expect(getComputedStyle(description!).lineHeight).toBe("16px");
  });

  it("uses the shared dialog hierarchy and compact secondary copy for Create PR", async () => {
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

    await expect.element(page.getByRole("heading", { name: "Create PR" })).toBeVisible();
    const description = document.querySelector<HTMLElement>('[data-slot="dialog-description"]');
    expect(description).not.toBeNull();
    expect(getComputedStyle(description!).fontSize).toBe("12px");
    expect(getComputedStyle(description!).lineHeight).toBe("16px");
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
    expect(getComputedStyle(description!).fontSize).toBe("12px");
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

  it("keeps the clean-state action legible and explains why it cannot run", async () => {
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

    const commitAndPush = page.getByRole("button", { name: "Commit and Push" });
    await expect.element(commitAndPush).toBeDisabled();
    await expect.element(page.getByText("Up to date", { exact: true })).toBeVisible();

    const branchTrigger = document.querySelector<HTMLElement>('[data-slot="combobox-trigger"]');
    const commitAndPushElement = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Commit and Push"]',
    );
    expect(branchTrigger).not.toBeNull();
    expect(commitAndPushElement).not.toBeNull();
    expect(getComputedStyle(commitAndPushElement!).opacity).toBe("1");
    expect(getComputedStyle(commitAndPushElement!).color).toBe(
      getComputedStyle(branchTrigger!).color,
    );
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

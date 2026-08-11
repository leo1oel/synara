// FILE: GitPanel.browser.tsx
// Purpose: Browser regressions for the embedded Source Control pane.
// Layer: Browser UI test

import "../../index.css";

import type { GitStatusResult, NativeApi } from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
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
      (_, index) => `-const oldValue${index + 1} = ${index + 1};`,
    ),
    ...Array.from(
      { length: lineCount },
      (_, index) => `+const newValue${index + 1} = ${index + 1};`,
    ),
    "",
  ].join("\n");
}

function gitStatus(branch: string): GitStatusResult {
  return {
    branch,
    hasWorkingTreeChanges: true,
    workingTree: {
      files: [{ path: "src/long.ts", insertions: 80, deletions: 80 }],
      insertions: 80,
      deletions: 80,
    },
    hasUpstream: true,
    upstreamBranch: branch,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
  };
}

function installGitApi() {
  let currentBranch = "feature/source-control";
  const checkoutCalls: string[] = [];
  const actionCalls: Array<{ action: string; filePaths?: string[] }> = [];
  const patch = buildLongPatch();

  window.nativeApi = {
    git: {
      listBranches: async () => ({
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
      }),
      status: async () => gitStatus(currentBranch),
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

  it("keeps every line in a long selected-file diff vertically scrollable", async () => {
    installGitApi();
    await renderWithQueryClient(
      <GitPanel hostThreadId={null} projectId={null} cwdOverride={TEST_CWD} title="Changes" />,
    );

    await page.getByRole("button", { name: /src\/long\.ts/ }).click();
    await expect.element(page.getByText("Rendering diff…")).not.toBeInTheDocument();

    const scrollContainer = document.querySelector<HTMLElement>("[data-git-diff-scroll]");
    expect(scrollContainer).not.toBeNull();
    expect(getComputedStyle(scrollContainer!).overflowY).toBe("auto");
    expect(scrollContainer!.scrollHeight).toBeGreaterThan(scrollContainer!.clientHeight);

    scrollContainer!.scrollTop = scrollContainer!.scrollHeight;
    scrollContainer!.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(scrollContainer!.scrollTop).toBeGreaterThan(0);
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

    const moreActionsElement = document.querySelector<HTMLButtonElement>(
      'button[aria-label="More Git actions"]',
    );
    const chevron = moreActionsElement?.querySelector<SVGElement>("svg") ?? null;
    expect(moreActionsElement).not.toBeNull();
    expect(chevron).not.toBeNull();
    const closedRotation = getComputedStyle(chevron!).rotate;

    await moreActions.click();
    await expect.element(moreActions).toHaveAttribute("aria-expanded", "true");
    await expect.element(page.getByText("Git actions", { exact: true })).toBeVisible();
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
    await page.getByRole("option", { name: /main/ }).click();

    await expect.poll(() => checkoutCalls).toEqual(["main"]);
    await expect
      .poll(() =>
        document.querySelector<HTMLElement>('[data-slot="combobox-trigger"]')?.textContent?.trim(),
      )
      .toBe("main");
  });
});

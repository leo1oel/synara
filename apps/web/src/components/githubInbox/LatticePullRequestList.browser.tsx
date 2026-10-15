// FILE: LatticePullRequestList.browser.tsx
// Purpose: Browser coverage for Lattice's Pull requests states that are not a list: a folder that
//          is not a Git repository, a repository with no GitHub remote, the GitHub CLI signed out,
//          and an unexpected failure. None of them prints Git's or gh's output as the message;
//          that stays under Details.
// Layer: GitHub inbox test

import "../../index.css";

import {
  type GitHubInboxListResult,
  type NativeApi,
  type ProjectId,
  PullRequestsUnavailableError,
} from "@synara/contracts";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { i18n } from "../../i18n";
import type { LatticeGitActions } from "../GitActionsControl";

// The Lattice variant only lays out what `renderLattice` returns; its runners are not under test.
vi.mock("../GitActionsControl", () => ({
  default: (props: { renderLattice?: (actions: LatticeGitActions) => ReactNode }) =>
    props.renderLattice?.({
      status: null,
      statusPending: false,
      isBusy: false,
      isPullRunning: false,
      isDefaultBranch: true,
      hasOriginRemote: false,
      defaultBranchName: "main",
      commit: () => {},
      writeCommitMessage: async () => ({ subject: "", body: "" }),
      push: () => {},
      pull: () => {},
      createPullRequest: { available: false, opensExisting: false, open: () => {} },
      menuContent: null,
      refreshMenuAvailability: () => {},
    }) ?? null,
}));

import { LatticePullRequestList } from "./LatticePullRequestList";

i18n.loadAndActivate({ locale: "en", messages: {} });

const PROJECT = "project-a" as ProjectId;
const ROOT = "/Users/Shared/paper";
const NOT_A_REPOSITORY = "fatal: not a git repository (or any of the parent directories): .git";

function emptyList(errors: GitHubInboxListResult["errors"] = []): GitHubInboxListResult {
  return {
    viewer: null,
    items: [],
    errors,
    repositoryBatches: [],
    rateLimit: null,
    reviewRequestedCount: 0,
    reviewRequestedCountIncomplete: errors.length > 0,
  } as GitHubInboxListResult;
}

function inventoryError(message: string): GitHubInboxListResult["errors"][number] {
  return {
    projectId: PROJECT,
    projectTitle: "Paper",
    repository: null,
    message,
    reason: "unavailable",
    retryAt: null,
    showingCachedData: false,
  };
}

let isRepo = false;
let hasOriginRemote = false;
const init = vi.fn(async () => {
  isRepo = true;
});

beforeEach(() => {
  isRepo = false;
  hasOriginRemote = false;
  init.mockClear();
  window.nativeApi = {
    git: {
      listBranches: async () => ({
        branches: [],
        isRepo,
        hasOriginRemote,
      }),
      init,
    },
  } as unknown as NativeApi;
});

afterEach(() => {
  delete (window as { nativeApi?: NativeApi }).nativeApi;
  document.documentElement.removeAttribute("data-synara-embed");
});

function renderList(props: { openList?: GitHubInboxListResult; openError?: unknown }) {
  document.documentElement.setAttribute("data-synara-embed", "true");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <div style={{ width: 280, height: 560 }}>
          <LatticePullRequestList
            workspaceRoot={ROOT}
            projectId={PROJECT}
            openList={props.openList}
            openPending={false}
            openError={props.openError}
            onRetry={() => {}}
            query=""
            onQueryChange={() => {}}
            onPasteReference={() => false}
            isSelected={() => false}
            onSelect={() => {}}
            loading={<p>Loading</p>}
          />
        </div>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

function expectNoHorizontalOverflow() {
  const root = document.querySelector<HTMLElement>("[data-lattice-pull-requests]")!;
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    expect(element.getBoundingClientRect().right).toBeLessThanOrEqual(
      root.getBoundingClientRect().right + 0.5,
    );
  }
}

describe("LatticePullRequestList without a usable repository", () => {
  it("says a folder without Git needs a repository, offers Initialize Git, and hides Git's error", async () => {
    renderList({ openList: emptyList([inventoryError(NOT_A_REPOSITORY)]) });

    await expect.element(page.getByText("Pull requests need a Git repository")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Initialize Git" })).toBeVisible();
    expect(document.querySelector('svg.research-art[data-kind="routing-envelope"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("fatal:");
    expect(document.querySelector('input[type="search"]')).toBeNull();
    expectNoHorizontalOverflow();

    await page.getByRole("button", { name: "Initialize Git" }).click();
    await vi.waitFor(() => expect(init).toHaveBeenCalledWith({ cwd: ROOT }));
  });

  it("offers Publish and Connect existing for a repository with no GitHub remote", async () => {
    isRepo = true;
    renderList({ openList: emptyList() });

    await expect.element(page.getByText("This project is not on GitHub")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Publish to GitHub" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Connect existing" })).toBeVisible();
    expectNoHorizontalOverflow();
  });

  it("asks to sign in to the GitHub CLI when gh is signed out", async () => {
    isRepo = true;
    renderList({
      openError: new PullRequestsUnavailableError({
        reason: "gh-not-authenticated",
        message: "You are not logged into any GitHub hosts. To log in, run: gh auth login",
      }),
    });

    await expect.element(page.getByText("Sign in to GitHub to see pull requests")).toBeVisible();
    await expect.element(page.getByText("gh auth login", { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("You are not logged into");
    expectNoHorizontalOverflow();
  });

  it("words an unexpected failure plainly and keeps the raw output under Details", async () => {
    isRepo = true;
    renderList({
      openError: new Error("gh: HTTP 502 Bad Gateway (https://api.github.com/graphql)"),
    });

    await expect.element(page.getByText("Pull requests could not be loaded")).toBeVisible();
    await expect
      .element(
        page.getByText("Lattice could not reach GitHub. Check your connection and try again"),
      )
      .toBeVisible();
    const details = document.querySelector<HTMLDetailsElement>(".lattice-git-details")!;
    expect(details.open).toBe(false);
    await expect
      .element(page.getByText("HTTP 502 Bad Gateway", { exact: false }))
      .not.toBeVisible();
    await page.getByText("Details").click();
    await expect.element(page.getByText("HTTP 502 Bad Gateway", { exact: false })).toBeVisible();
    expectNoHorizontalOverflow();
  });

  it("keeps a remote read failure as a sentence with the output under Details", async () => {
    isRepo = true;
    hasOriginRemote = true;
    renderList({
      openList: emptyList([inventoryError("fatal: bad config line 3 in file .git/config")]),
    });

    await expect.element(page.getByText("Could not read this project’s Git remotes")).toBeVisible();
    expect(document.querySelector(".lattice-prs-warning .lattice-git-details")).not.toBeNull();
    await expect.element(page.getByText("bad config line", { exact: false })).not.toBeVisible();
  });
});

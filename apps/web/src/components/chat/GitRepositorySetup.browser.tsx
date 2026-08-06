// FILE: GitRepositorySetup.browser.tsx
// Purpose: Browser regressions for the source-control onboarding and GitHub setup surfaces.
// Layer: Browser UI test

import "../../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { GitHubRemoteSetupCard, GitInitializationState } from "./GitRepositorySetup";

function renderWithQueryClient(element: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <div className="h-[640px] w-[360px] bg-background text-foreground">{element}</div>
    </QueryClientProvider>,
  );
}

describe("GitRepositorySetup", () => {
  it("uses the app typography and a compact primary action for Git initialization", async () => {
    await renderWithQueryClient(<GitInitializationState cwd="/tmp/research-writer" />);

    await expect
      .element(page.getByRole("heading", { name: "Start version control" }))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Initialize Git" })).toBeVisible();

    const heading = document.querySelector("h2");
    const action = document.querySelector<HTMLButtonElement>('button[data-slot="button"]');
    expect(heading).not.toBeNull();
    expect(action).not.toBeNull();
    expect(getComputedStyle(heading!).fontWeight).toBe("500");
    expect(action!.getBoundingClientRect().height).toBeLessThanOrEqual(32);
  });

  it("opens a styled publish dialog with private visibility selected by default", async () => {
    await renderWithQueryClient(<GitHubRemoteSetupCard cwd="/tmp/research writer" />);

    const publishButton = page.getByRole("button", { name: "Publish" });
    await expect.element(publishButton).toBeVisible();
    await publishButton.click();

    await expect.element(page.getByRole("heading", { name: "Publish to GitHub" })).toBeVisible();
    await expect.element(page.getByLabelText("Repository name")).toHaveValue("research-writer");
    await expect
      .element(page.getByRole("radio", { name: "Private Only you and invited collaborators" }))
      .toHaveAttribute("aria-checked", "true");
    await expect.element(page.getByRole("button", { name: "Create repository" })).toBeVisible();
  });

  it("opens the existing-repository flow without exposing upload actions", async () => {
    await renderWithQueryClient(<GitHubRemoteSetupCard cwd="/tmp/research-writer" />);

    const connectButton = page.getByRole("button", { name: "Connect existing" });
    await expect.element(connectButton).toBeVisible();
    await connectButton.click();

    await expect
      .element(page.getByRole("heading", { name: "Connect GitHub repository" }))
      .toBeVisible();
    await expect
      .element(page.getByLabelText("Repository URL"))
      .toHaveAttribute("placeholder", "https://github.com/owner/repository.git");
    expect(document.body.textContent).not.toContain("Upload");
  });
});

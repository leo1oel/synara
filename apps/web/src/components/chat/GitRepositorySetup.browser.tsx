// FILE: GitRepositorySetup.browser.tsx
// Purpose: Browser regressions for the source-control onboarding and GitHub setup surfaces.
// Layer: Browser UI test

import "../../index.css";

import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { i18n } from "../../i18n";
import { GitHubRemoteSetupCard, GitInitializationState } from "./GitRepositorySetup";

i18n.loadAndActivate({ locale: "en", messages: {} });

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
        <div className="h-[640px] w-[360px] bg-background text-foreground">{element}</div>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

function backgroundAlpha(element: Element): number {
  const color = getComputedStyle(element).backgroundColor;
  const slashAlpha = color.match(/\/\s*([\d.]+)\s*\)$/)?.[1];
  if (slashAlpha) return Number(slashAlpha);
  const rgbaAlpha = color.match(/^rgba\(.+,\s*([\d.]+)\)$/)?.[1];
  return rgbaAlpha ? Number(rgbaAlpha) : 1;
}

describe("GitRepositorySetup", () => {
  afterEach(async () => {
    await page.viewport(414, 896);
  });

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
    await page.viewport(451, 552);
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

    const createButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Create repository",
    );
    expect(createButton).toBeDefined();
    expect(createButton!.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);

    const selectedVisibility = document.querySelector<HTMLButtonElement>(
      '[role="radio"][aria-checked="true"]',
    );
    expect(selectedVisibility).not.toBeNull();
    const selectedAlpha = backgroundAlpha(selectedVisibility!);
    await page.getByRole("radio", { name: "Private Only you and invited collaborators" }).hover();
    expect(backgroundAlpha(selectedVisibility!)).toBeGreaterThan(selectedAlpha);
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

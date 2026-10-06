// FILE: SkillsSettingsPanel.browser.tsx
// Purpose: Guards list/detail scroll navigation in the Skills settings panel.
// Layer: Browser UI test

import "../../index.css";

import type { ProviderSkillDescriptor } from "@synara/contracts";
import { DEFAULT_SERVER_SETTINGS } from "@synara/contracts";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { i18n } from "../../i18n";
import { messages } from "../../locales/en/messages.po";
import { providerDiscoveryQueryKeys } from "../../lib/providerDiscoveryReactQuery";
import { serverQueryKeys } from "../../lib/serverReactQuery";
import { SkillsSettingsPanel } from "./SkillsSettingsPanel";

function managedSkill(index: number): ProviderSkillDescriptor {
  const name = `bundled-skill-${String(index).padStart(2, "0")}`;
  return {
    name,
    description: `Description for ${name}`,
    path: `/bundled/${name}/SKILL.md`,
    enabled: true,
    scope: "synara",
    management: { kind: "bundled", id: name, canDelete: false },
  };
}

describe("SkillsSettingsPanel navigation", () => {
  afterEach(async () => {
    await page.viewport(1280, 720);
    document.body.innerHTML = "";
  });

  it("opens detail at the top and restores the scrolled list position on back", async () => {
    await page.viewport(620, 480);
    i18n.loadAndActivate({ locale: "en", messages });
    const skills = Array.from({ length: 18 }, (_, index) => managedSkill(index));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(providerDiscoveryQueryKeys.skillsCatalog(null), { skills });
    queryClient.setQueryData(serverQueryKeys.settings(), DEFAULT_SERVER_SETTINGS);
    for (const skill of skills) {
      queryClient.setQueryData(
        ["managed-skill-detail", skill.management?.kind, skill.management?.id],
        { skill, markdown: `# ${skill.name}\n\nInstructions`, files: ["SKILL.md"] },
      );
    }

    const scrollOwner = document.createElement("div");
    scrollOwner.className = "synara-settings-scroll h-80 overflow-y-auto";
    document.body.append(scrollOwner);
    const mounted = await render(
      <I18nProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <SkillsSettingsPanel />
        </QueryClientProvider>
      </I18nProvider>,
      { container: scrollOwner },
    );

    scrollOwner.scrollTop = scrollOwner.scrollHeight;
    const listScrollTop = scrollOwner.scrollTop;
    expect(listScrollTop).toBeGreaterThan(0);
    await mounted.getByRole("button", { name: "Open bundled-skill-17 details" }).click();

    await expect.element(mounted.getByRole("button", { name: "All skills" })).toBeVisible();
    expect(scrollOwner.scrollTop).toBe(0);
    expect(document.querySelector("[data-slot='managed-skill-detail']")).not.toBeNull();
    await page.screenshot();

    await mounted.getByRole("button", { name: "All skills" }).click();
    await expect.element(mounted.getByText("Skills Manager")).toBeVisible();
    expect(scrollOwner.scrollTop).toBe(listScrollTop);

    await mounted.unmount();
    queryClient.clear();
  });
});

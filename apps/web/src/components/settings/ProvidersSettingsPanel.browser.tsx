// FILE: ProvidersSettingsPanel.browser.tsx
// Purpose: Guards provider update row geometry in Lattice's embedded settings surface.
// Layer: Browser UI test

import "../../index.css";

import type { ServerProviderStatus } from "@synara/contracts";
import { I18nProvider } from "@lingui/react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ProviderUpdateAction, ProviderUpdateRow } from "./ProvidersSettingsPanel";
import { i18n } from "../../i18n";
import { messages } from "../../locales/zh-CN/messages.po";

const codexStatus: ServerProviderStatus = {
  provider: "codex",
  status: "ready",
  available: true,
  authStatus: "authenticated",
  checkedAt: "2026-09-09T12:00:00.000Z",
  version: "1.2.3",
  versionAdvisory: {
    status: "behind_latest",
    currentVersion: "1.2.3",
    latestVersion: "1.3.0",
    canUpdate: true,
    updateCommand: "npm update -g @openai/codex",
  },
};

describe("ProvidersSettingsPanel embedded update rows", () => {
  afterEach(async () => {
    await page.viewport(1280, 720);
    delete document.documentElement.dataset.synaraEmbed;
    document.body.innerHTML = "";
  });

  it("matches provider runtime row geometry and keeps update states on the right", async () => {
    await page.viewport(560, 360);
    document.documentElement.dataset.synaraEmbed = "true";
    i18n.loadAndActivate({ locale: "zh-CN", messages });
    const onUpdate = vi.fn();

    const host = document.createElement("div");
    host.className = "app-settings-surface p-6";
    document.body.append(host);
    const mounted = await render(
      <I18nProvider i18n={i18n}>
        <div className="overflow-hidden rounded-lg border border-border/70 divide-y divide-border/70">
          <ProviderUpdateRow
            provider="Codex"
            status="v1.2.3 → v1.3.0"
            action={
              <ProviderUpdateAction
                providerStatus={codexStatus}
                active={false}
                disabled={false}
                onUpdate={onUpdate}
              />
            }
          />
          <ProviderUpdateRow
            provider="Claude"
            status="v2.0.0 → v2.1.0"
            action={
              <span className="text-[11px] text-muted-foreground">{i18n._("Manual update")}</span>
            }
          />
          <ProviderUpdateRow
            provider="Cursor"
            status={i18n._("Updating")}
            action={
              <ProviderUpdateAction
                providerStatus={{ ...codexStatus, provider: "cursor" }}
                active
                disabled
                onUpdate={onUpdate}
              />
            }
          />
        </div>
      </I18nProvider>,
      { container: host },
    );

    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("[data-slot='provider-update-row']"),
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(45);
    }

    const updateButton = mounted.getByRole("button", { name: "更新", exact: true });
    await updateButton.click();
    expect(onUpdate).toHaveBeenCalledWith("codex");

    const provider = mounted.getByText("Codex").element();
    const status = mounted.getByText("v1.2.3 → v1.3.0").element();
    expect(provider.getBoundingClientRect().left).toBeLessThan(status.getBoundingClientRect().left);
    expect(status.getBoundingClientRect().right).toBeLessThan(
      updateButton.element().getBoundingClientRect().left,
    );

    await page.screenshot();
    await mounted.unmount();
  });
});

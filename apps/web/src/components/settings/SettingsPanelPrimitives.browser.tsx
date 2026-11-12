// FILE: SettingsPanelPrimitives.browser.tsx
// Purpose: Guards embedded settings row geometry at Lattice's narrow iframe width.
// Layer: Browser UI test

import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { SettingsListRow } from "./SettingsPanelPrimitives";

describe("SettingsPanelPrimitives embedded layout", () => {
  afterEach(async () => {
    await page.viewport(1280, 720);
    delete document.documentElement.dataset.synaraEmbed;
    document.body.innerHTML = "";
  });

  it("keeps provider actions beside their labels below the standalone breakpoint", async () => {
    await page.viewport(560, 800);
    document.documentElement.dataset.synaraEmbed = "true";

    const host = document.createElement("div");
    host.className = "app-settings-surface";
    document.body.append(host);
    const mounted = await render(
      <div className="w-full">
        <SettingsListRow
          title="Codex"
          description="Background activity allowed"
          actions={<button type="button">Enabled</button>}
          className="px-3"
        />
        <SettingsListRow
          title="Claude"
          description="v1.0 → v1.1"
          actions={<button type="button">Update</button>}
          className="px-3"
        />
      </div>,
      { container: host },
    );

    const description = mounted.getByText("Background activity allowed").element();
    const enabledButton = mounted.getByRole("button", { name: "Enabled" }).element();
    const updateButton = mounted.getByRole("button", { name: "Update" }).element();

    expect(enabledButton.getBoundingClientRect().top).toBeLessThan(
      description.getBoundingClientRect().bottom,
    );
    expect(
      Math.abs(
        enabledButton.getBoundingClientRect().right - updateButton.getBoundingClientRect().right,
      ),
    ).toBeLessThanOrEqual(1);

    await mounted.unmount();
  });
});

// FILE: switch.browser.tsx
// Purpose: Guards Base UI switch behavior and the compact Lattice embed geometry.
// Layer: Browser UI test

import "../../index.css";

import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { Switch } from "./switch";

describe("Switch", () => {
  afterEach(async () => {
    delete document.documentElement.dataset.synaraEmbed;
    document.body.innerHTML = "";
  });

  it("keeps Base UI uncontrolled, keyboard, disabled, and form behavior", async () => {
    const onCheckedChange = vi.fn();
    const mounted = await render(
      <form>
        <Switch aria-label="Notifications" defaultChecked name="notifications" />
        <Switch aria-label="Disabled" disabled onCheckedChange={onCheckedChange} />
      </form>,
    );
    const toggle = mounted.getByRole("switch", { name: "Notifications" });
    const disabled = mounted.getByRole("switch", { name: "Disabled" });

    await expect.element(toggle).toBeChecked();
    toggle.element().focus();
    await userEvent.keyboard(" ");
    await expect.element(toggle).not.toBeChecked();
    await toggle.click();
    await expect.element(toggle).toBeChecked();
    expect(new FormData(document.querySelector("form")!).get("notifications")).toBe("on");

    await disabled.click({ force: true });
    await expect.element(disabled).not.toBeChecked();
    expect(onCheckedChange).not.toHaveBeenCalled();

    toggle.element().focus();
    expect(toggle.element()).toBe(document.activeElement);
    await mounted.unmount();
  });

  it("uses the compact 28 by 16 geometry in embedded settings", async () => {
    document.documentElement.dataset.synaraEmbed = "true";
    const host = document.createElement("div");
    host.className = "app-settings-surface flex gap-4 p-10";
    host.style.setProperty("--lattice-settings-line-strong", "#71717a");
    host.style.setProperty("--lattice-settings-accent", "#2563eb");
    host.style.setProperty("--lattice-settings-panel", "#ffffff");
    document.body.append(host);
    const mounted = await render(
      <>
        <Switch aria-label="Embedded" defaultChecked />
        <Switch aria-label="Embedded disabled" disabled />
      </>,
      { container: host },
    );
    const toggle = mounted.getByRole("switch", { name: "Embedded", exact: true }).element();
    const thumb = toggle.querySelector<HTMLElement>("[data-slot='switch-thumb']")!;

    expect(toggle.getBoundingClientRect().width).toBe(28);
    expect(toggle.getBoundingClientRect().height).toBe(16);
    expect(thumb.getBoundingClientRect().width).toBe(12);
    expect(thumb.getBoundingClientRect().height).toBe(12);
    expect(thumb.getBoundingClientRect().left - toggle.getBoundingClientRect().left).toBe(14);
    await userEvent.hover(toggle);
    await expect.poll(() => thumb.getBoundingClientRect().width).toBeCloseTo(14.4, 1);
    await userEvent.click(toggle);
    await userEvent.unhover(toggle);
    await expect.poll(() => thumb.getBoundingClientRect().left - toggle.getBoundingClientRect().left).toBeCloseTo(2, 1);
    await userEvent.click(toggle);
    await userEvent.unhover(toggle);
    await expect.poll(() => thumb.getBoundingClientRect().left - toggle.getBoundingClientRect().left).toBeCloseTo(14, 1);
    await expect.poll(() => thumb.getBoundingClientRect().width).toBeCloseTo(12, 1);
    await page.screenshot();

    await mounted.unmount();
  });
});

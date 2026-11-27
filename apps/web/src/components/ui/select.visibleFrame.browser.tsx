import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

vi.mock("~/embedMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/embedMode")>()),
  isSynaraEmbedMode: () => true,
}));

import { SettingsSelectControl } from "../settings/SettingControls";
import { SelectItem } from "./select";

const MODELS = Array.from({ length: 40 }, (_, index) => `Model ${index + 1}`);
const VISIBLE_HEIGHT = 360;

// Lattice sizes the embedded Settings frame to the whole page, taller than the
// sheet that shows it. This observer reports what the sheet shows: the top
// VISIBLE_HEIGHT pixels of the frame.
class SheetClippedIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    const intersectionRect = new DOMRectReadOnly(0, 0, window.innerWidth, VISIBLE_HEIGHT);
    queueMicrotask(() =>
      this.callback(
        [{ target, intersectionRect, isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      ),
    );
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("keeps an embedded settings list inside the part of the frame Lattice shows", async () => {
  vi.stubGlobal("IntersectionObserver", SheetClippedIntersectionObserver);
  await page.viewport(900, 1600);
  await render(
    <div style={{ paddingTop: 120, height: 1500 }}>
      <SettingsSelectControl
        value="Model 1"
        onValueChange={vi.fn()}
        ariaLabel="Proofreading model"
        valueContent="Model 1"
      >
        {MODELS.map((model) => (
          <SelectItem key={model} value={model}>
            {model}
          </SelectItem>
        ))}
      </SettingsSelectControl>
    </div>,
  );
  await page.getByRole("combobox", { name: "Proofreading model" }).click();
  await expect.element(page.getByRole("option", { name: "Model 1", exact: true })).toBeVisible();

  await expect
    .poll(
      () => document.querySelector('[data-slot="select-popup"]')?.getBoundingClientRect().bottom,
    )
    .toBeLessThanOrEqual(VISIBLE_HEIGHT);
});

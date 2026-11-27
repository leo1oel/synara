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

// Lattice sizes the embedded Settings frame to the whole page, taller than the
// sheet that shows it. This observer reports what the sheet shows, and lets a
// test report a new visible part, as when Lattice scrolls the frame.
let reportVisible: ((top: number, height: number) => void) | undefined;
let frameObserver: SheetClippedIntersectionObserver | undefined;
let observedThresholds: ReadonlyArray<number> = [];

class SheetClippedIntersectionObserver {
  constructor(
    private readonly callback: IntersectionObserverCallback,
    private readonly options?: IntersectionObserverInit,
  ) {}
  observe(target: Element) {
    // Other components observe their own elements; only the frame's root matters.
    if (target !== document.documentElement) return;
    frameObserver = this;
    observedThresholds = [this.options?.threshold ?? 0].flat();
    reportVisible = (top, height) =>
      this.callback(
        [
          {
            target,
            intersectionRect: new DOMRectReadOnly(0, top, window.innerWidth, height),
            isIntersecting: true,
          } as IntersectionObserverEntry,
        ],
        this as unknown as IntersectionObserver,
      );
  }
  disconnect() {
    if (frameObserver === this) reportVisible = undefined;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  reportVisible = undefined;
});

async function openPicker() {
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
  await expect.poll(() => reportVisible).toBeDefined();
}

function popupRect(): DOMRect | undefined {
  return document.querySelector('[data-slot="select-popup"]')?.getBoundingClientRect();
}

function positionerVisibility(): string | undefined {
  const positioner = document.querySelector<HTMLElement>('[data-slot="select-positioner"]');
  return positioner ? getComputedStyle(positioner).visibility : undefined;
}

it("keeps an embedded settings list inside the part of the frame Lattice shows", async () => {
  await openPicker();
  // Hidden until the visible part is known, so it never paints against the
  // whole frame first.
  expect(positionerVisibility()).toBe("hidden");

  reportVisible?.(0, 360);
  await expect.poll(positionerVisibility).toBe("visible");
  await expect.poll(() => popupRect()?.bottom).toBeLessThanOrEqual(360);
});

it("follows the visible part as Lattice scrolls the frame under an open list", async () => {
  await openPicker();
  expect(observedThresholds.length).toBeGreaterThan(50);

  reportVisible?.(0, 360);
  await expect.poll(() => popupRect()?.bottom).toBeLessThanOrEqual(360);

  // Lattice scrolled the frame up: the sheet now shows from 100px down to 1100px.
  reportVisible?.(100, 1000);
  await expect.poll(() => popupRect()?.top).toBeGreaterThanOrEqual(100);
  await expect.poll(() => popupRect()?.bottom).toBeGreaterThan(360);
});

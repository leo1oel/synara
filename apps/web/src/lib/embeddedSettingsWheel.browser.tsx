import "../index.css";

import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { SettingsSelectControl } from "../components/settings/SettingControls";
import { SelectItem } from "../components/ui/select";
import { listenForEmbeddedSettingsWheel } from "./embeddedSettingsWheel";

const MODELS = Array.from({ length: 40 }, (_, index) => `Model ${index + 1}`);

let stopListening: (() => void) | undefined;

afterEach(() => {
  stopListening?.();
  stopListening = undefined;
});

async function renderModelPicker() {
  const forwarded = vi.fn<(event: WheelEvent) => void>();
  stopListening = listenForEmbeddedSettingsWheel(forwarded);
  await render(
    <div>
      <p data-testid="settings-text">Proofreading model</p>
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
  return forwarded;
}

function optionList(): HTMLElement {
  const list = document.querySelector<HTMLElement>('[data-slot="menu-popup-body"]');
  if (!list) throw new Error("The option list is not open.");
  return list;
}

it("forwards a wheel over the page itself to Lattice", async () => {
  const forwarded = await renderModelPicker();
  await userEvent.wheel(page.getByTestId("settings-text"), { delta: { y: 120 } });
  expect(forwarded).toHaveBeenCalledTimes(1);
  expect(forwarded.mock.calls[0]?.[0].deltaY).toBe(120);
});

it("scrolls an open model list with the wheel instead of forwarding it", async () => {
  const forwarded = await renderModelPicker();
  await page.getByRole("combobox", { name: "Proofreading model" }).click();
  await expect.element(page.getByRole("option", { name: "Model 1", exact: true })).toBeVisible();
  const list = optionList();
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);

  await userEvent.wheel(page.getByRole("option", { name: "Model 2", exact: true }), {
    delta: { y: 240 },
  });
  await expect.poll(() => list.scrollTop).toBeGreaterThan(0);
  expect(forwarded).not.toHaveBeenCalled();

  // At the end of the list the wheel still belongs to it: the list contains its
  // overscroll, so the Settings page behind the picker must not move either.
  list.scrollTop = list.scrollHeight;
  await userEvent.wheel(page.getByRole("option", { name: "Model 40", exact: true }), {
    delta: { y: 120 },
  });
  expect(forwarded).not.toHaveBeenCalled();
});

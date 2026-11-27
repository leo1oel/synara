import "../index.css";

import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { SettingsSelectControl } from "../components/settings/SettingControls";
import { SelectItem } from "../components/ui/select";
import { listenForEmbeddedSettingsWheel, WHEEL_GESTURE_GAP_MS } from "./embeddedSettingsWheel";

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

function sendWheel(target: Element): WheelEvent {
  const event = new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function waitForNextGesture(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, WHEEL_GESTURE_GAP_MS * 2));
}

it("keeps a wheel gesture on the page or the list it started on", async () => {
  const forwarded = await renderModelPicker();
  await page.getByRole("combobox", { name: "Proofreading model" }).click();
  await expect.element(page.getByRole("option", { name: "Model 1", exact: true })).toBeVisible();
  const text = page.getByTestId("settings-text").element();
  const option = page.getByRole("option", { name: "Model 2", exact: true }).element();

  // Started on the page: the list sliding under the pointer mid-gesture does
  // not take the rest of it.
  expect(sendWheel(text).defaultPrevented).toBe(true);
  expect(sendWheel(option).defaultPrevented).toBe(true);
  expect(forwarded).toHaveBeenCalledTimes(2);

  // A pause ends the gesture, so the next one over the list scrolls the list.
  await waitForNextGesture();
  expect(sendWheel(option).defaultPrevented).toBe(false);
  expect(sendWheel(text).defaultPrevented).toBe(false);
  expect(forwarded).toHaveBeenCalledTimes(2);

  await waitForNextGesture();
  expect(sendWheel(text).defaultPrevented).toBe(true);
  expect(forwarded).toHaveBeenCalledTimes(3);
});

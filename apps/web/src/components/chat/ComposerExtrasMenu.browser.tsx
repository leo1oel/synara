// FILE: ComposerExtrasMenu.browser.tsx
// Purpose: Verifies the composer `+` menu exposes image uploads and plan mode without duplicating
// model capability controls owned by the model/effort picker.
// Layer: Browser UI test
// Depends on: vitest browser rendering helpers and the ComposerExtrasMenu component.

import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ComposerExtrasMenu } from "./ComposerExtrasMenu";

async function mountMenu(props?: { interactionMode?: "default" | "plan"; triggerClassName?: string }) {
  const onAddPhotos = vi.fn();
  const onSetPlanMode = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <ComposerExtrasMenu
      interactionMode={props?.interactionMode ?? "default"}
      onAddPhotos={onAddPhotos}
      onSetPlanMode={onSetPlanMode}
      triggerClassName={props?.triggerClassName}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
    onAddPhotos,
    onSetPlanMode,
  };
}

describe("ComposerExtrasMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses an image-only file picker and forwards selected images", async () => {
    await using menu = await mountMenu();

    const input = document.querySelector<HTMLInputElement>("[data-testid='composer-photo-input']");
    expect(input).not.toBeNull();
    expect(input?.accept).toBe("image/*");

    const files = new DataTransfer();
    files.items.add(new File(["photo"], "photo.png", { type: "image/png" }));
    Object.defineProperty(input, "files", {
      configurable: true,
      value: files.files,
    });
    input?.dispatchEvent(new Event("change", { bubbles: true }));

    expect(menu.onAddPhotos).toHaveBeenCalledTimes(1);
    expect(menu.onAddPhotos.mock.calls[0]?.[0]?.[0]?.name).toBe("photo.png");
  });

  it("shows the attachment action in the menu", async () => {
    await using _ = await mountMenu({ interactionMode: "plan" });

    await page.getByLabelText("Composer extras").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Add image");
      expect(text).toContain("Plan mode");
      expect(text).not.toContain("Fast");
      expect(text).not.toContain("Plugins");
    });
  });

  it("wires plan mode without exposing a duplicate speed control", async () => {
    await using menu = await mountMenu();

    await page.getByLabelText("Composer extras").click();
    await page.getByText("Plan mode").click();

    expect(menu.onSetPlanMode).toHaveBeenCalledWith(true);
    expect(document.body.textContent ?? "").not.toContain("Fast");
  });

  it("can keep the embed trigger at a fixed size across viewport breakpoints", async () => {
    await using _ = await mountMenu({ triggerClassName: "!size-8" });

    const trigger = page.getByLabelText("Composer extras").element();
    expect(getComputedStyle(trigger).width).toBe("32px");
    expect(getComputedStyle(trigger).height).toBe("32px");
  });
});

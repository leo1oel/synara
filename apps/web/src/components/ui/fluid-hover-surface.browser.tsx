import "../../index.css";

import { MotionConfig } from "motion/react";
import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { Menu, MenuItem, MenuPopupBase, MenuRadioGroup, MenuRadioItem } from "./menu";
import { SidebarMenu, SidebarMenuSubButton, SidebarMenuSubItem } from "./sidebar";

const anchor = { getBoundingClientRect: () => new DOMRect(40, 40, 0, 0) };

function ModelMenu({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const menu = (
    <Menu open>
      <MenuPopupBase anchor={anchor} align="start" side="bottom">
        <MenuRadioGroup value="opus">
          <MenuRadioItem value="sonnet">Sonnet 5</MenuRadioItem>
          <MenuRadioItem value="opus">Opus 4.8</MenuRadioItem>
          <MenuRadioItem disabled value="offline">
            Offline model
          </MenuRadioItem>
        </MenuRadioGroup>
        <MenuItem>New assistant chat</MenuItem>
      </MenuPopupBase>
    </Menu>
  );
  return reducedMotion ? <MotionConfig reducedMotion="always">{menu}</MotionConfig> : menu;
}

describe("FluidHoverSurface", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("covers top-level chat rows without suppressing nested action backgrounds", async () => {
    const screen = await render(
      <div style={{ width: 300, transform: "scale(.9)", transformOrigin: "top left" }}>
        <SidebarMenu>
          <SidebarMenuSubItem>
            <SidebarMenuSubButton render={<button />}>First chat</SidebarMenuSubButton>
          </SidebarMenuSubItem>
          <SidebarMenuSubItem>
            <SidebarMenuSubButton render={<button />}>
              Second chat<span style={{ background: "rgb(255, 0, 0)" }}>Status</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        </SidebarMenu>
      </div>,
    );
    await page.getByRole("button", { name: "First chat" }).hover();
    const second = page.getByRole("button", { name: /Second chat/ });
    await second.hover();
    await expect
      .poll(() => {
        const fill = document
          .querySelector('[data-slot="fluid-hover-highlight"]')
          ?.getBoundingClientRect();
        return fill ? Math.abs(fill.top - second.element().getBoundingClientRect().top) : 100;
      })
      .toBeLessThan(1);
    expect(getComputedStyle(page.getByText("Status").element()).backgroundColor).toBe(
      "rgb(255, 0, 0)",
    );
    second
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(second.element().hasAttribute("data-fluid-hover-active")).toBe(false);
    await screen.unmount();
  });

  it("moves one shared fill while preserving selected, disabled, and click behavior", async () => {
    const screen = await render(<ModelMenu />);
    const sonnet = page.getByText("Sonnet 5", { exact: true });
    const opus = page.getByText("Opus 4.8", { exact: true });

    await sonnet.hover();
    const highlight = document.querySelector<HTMLElement>('[data-slot="fluid-hover-highlight"]');
    expect(highlight).not.toBeNull();
    const firstTop = highlight!.getBoundingClientRect().top;
    await opus.hover();
    await expect
      .poll(
        () =>
          document
            .querySelector<HTMLElement>('[data-slot="fluid-hover-highlight"]')
            ?.getBoundingClientRect().top ?? 0,
      )
      .toBeGreaterThan(firstTop);
    expect(opus.element().closest("[role='menuitemradio']")?.hasAttribute("data-checked")).toBe(
      true,
    );

    const disabledItem = page
      .getByText("Offline model", { exact: true })
      .element()
      .closest<HTMLElement>("[role='menuitemradio']")!;
    disabledItem.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }),
    );
    await expect
      .poll(() => document.querySelector('[data-slot="fluid-hover-highlight"]'))
      .toBeNull();
    await userEvent.click(page.getByText("New assistant chat", { exact: true }));
    await screen.unmount();
  });

  it.each([
    ["light", false],
    ["dark", true],
  ] as const)("renders the real menu interaction in %s mode", async (name, dark) => {
    document.documentElement.classList.toggle("dark", dark);
    const screen = await render(<ModelMenu />);
    await page.getByText("Sonnet 5", { exact: true }).hover();
    await page.screenshot();
    await screen.unmount();
  });

  it("renders without travel under reduced motion", async () => {
    const screen = await render(<ModelMenu reducedMotion />);
    await page.getByText("Sonnet 5", { exact: true }).hover();
    const action = page.getByText("New assistant chat", { exact: true });
    await action.hover();
    await expect
      .poll(() => {
        const fill = document.querySelector<HTMLElement>('[data-slot="fluid-hover-highlight"]');
        if (!fill || Number(getComputedStyle(fill).opacity) < 0.99) return 100;
        return Math.abs(
          fill.getBoundingClientRect().top - action.element().getBoundingClientRect().top,
        );
      })
      .toBeLessThan(1);
    await page.screenshot();
    await screen.unmount();
  });
});

import "../../index.css";

import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { dismissOpenPopups } from "~/latticePopupDismissal";
import { Menu, MenuItem, MenuPopupBase, MenuTrigger } from "./menu";
import { Popover, PopoverPopup, PopoverTrigger } from "./popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./select";

// The press Lattice relays from outside the embed frame is replayed on this
// document's root; every primitive must close on it as on a real outside press.
function Popups(props: { onChange: (name: string, open: boolean, reason: string) => void }) {
  const [value, setValue] = useState("gpt");
  return (
    <div>
      <Menu onOpenChange={(open, details) => props.onChange("menu", open, details.reason)}>
        <MenuTrigger>Open menu</MenuTrigger>
        <MenuPopupBase>
          <MenuItem>Rename</MenuItem>
        </MenuPopupBase>
      </Menu>
      <Select
        value={value}
        onValueChange={(next) => setValue(next ?? "gpt")}
        onOpenChange={(open, details) => props.onChange("select", open, details.reason)}
      >
        <SelectTrigger aria-label="Model">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup surface="composer">
          <SelectItem value="gpt">GPT</SelectItem>
          <SelectItem value="claude">Claude</SelectItem>
        </SelectPopup>
      </Select>
      <Popover onOpenChange={(open, details) => props.onChange("popover", open, details.reason)}>
        <PopoverTrigger>Open popover</PopoverTrigger>
        <PopoverPopup>Popover body</PopoverPopup>
      </Popover>
    </div>
  );
}

describe("host popup dismissal", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it.each([
    ["menu", "Open menu", "Rename"],
    ["select", "Model", "Claude"],
    ["popover", "Open popover", "Popover body"],
  ])("closes an open %s as an outside press", async (name, trigger, content) => {
    const changes: string[] = [];
    const screen = await render(
      <Popups onChange={(popup, open, reason) => changes.push(`${popup}:${open}:${reason}`)} />,
    );
    const button =
      name === "select" ? page.getByLabelText(trigger) : page.getByText(trigger, { exact: true });
    await button.click();
    await expect.element(page.getByText(content, { exact: true })).toBeVisible();

    await dismissOpenPopups();

    // A Select keeps its closed popup mounted; the others unmount theirs.
    await expect.element(button).toHaveAttribute("aria-expanded", "false");
    // (A Select also hears the replayed mouseup as the release of the press that
    // opened it, which the test's instant click never delivered.)
    expect(changes.slice(0, 2)).toEqual([
      `${name}:true:trigger-press`,
      `${name}:false:outside-press`,
    ]);

    // A closed popup is no longer counted, even one (a Select's) that stays mounted.
    const dispatch = vi.spyOn(document.documentElement, "dispatchEvent");
    await dismissOpenPopups();
    expect(dispatch).not.toHaveBeenCalled();
    dispatch.mockRestore();
    await screen.unmount();
  });
});

import "../../index.css";

import { ThreadId } from "@synara/contracts";
import { useState } from "react";
import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const api = vi.hoisted(() => ({
  getNativeSessionHandoff: vi.fn(),
}));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => ({ orchestration: api }) }));

import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import { ContinueInTerminalMenuItem } from "./ContinueInTerminalMenuItem";

const THREAD_ID = ThreadId.makeUnsafe("chat-1");
const COMMAND = "cd '/Users/me/Papers/thesis' && claude --resume 5f0c2d4e";

function HistoryMenu() {
  const [open, setOpen] = useState(false);
  return (
    <Menu modal={false} open={open} onOpenChange={setOpen}>
      <MenuTrigger render={<button type="button">History</button>} />
      <ComposerPickerMenuPopup align="start" side="bottom">
        <MenuItem>Lattice chat</MenuItem>
        <ContinueInTerminalMenuItem threadId={THREAD_ID} open={open} />
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getNativeSessionHandoff.mockResolvedValue({
    status: "available",
    provider: "claudeAgent",
    nativeId: "5f0c2d4e",
    cwd: "/Users/me/Papers/thesis",
    command: COMMAND,
  });
});

describe("continue in terminal in the history menu", () => {
  it("copies the resume command for the active chat and says what stays behind", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await render(<HistoryMenu />);
    expect(api.getNativeSessionHandoff).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "History" }).click();
    expect(api.getNativeSessionHandoff).toHaveBeenCalledWith({ threadId: THREAD_ID });
    await expect
      .element(page.getByText("Outside Lattice, the bibliography guard and undo don't apply."))
      .toBeVisible();

    await page.getByRole("menuitem", { name: /Continue in terminal/ }).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(COMMAND));
  });

  it("is disabled, with the reason, before the chat's agent session exists", async () => {
    api.getNativeSessionHandoff.mockResolvedValue({
      status: "unavailable",
      reason: "noNativeSession",
    });
    await render(<HistoryMenu />);
    await page.getByRole("button", { name: "History" }).click();
    const item = page.getByRole("menuitem", { name: /Continue in terminal/ });
    await expect.element(item).toHaveAttribute("aria-disabled", "true");
    await expect
      .element(page.getByText("No Codex or Claude Code session yet. Send a message first."))
      .toBeVisible();
  });

  it("is hidden for an agent with no terminal session of its own", async () => {
    api.getNativeSessionHandoff.mockResolvedValue({
      status: "unavailable",
      reason: "unsupportedProvider",
    });
    await render(<HistoryMenu />);
    await page.getByRole("button", { name: "History" }).click();
    await expect.element(page.getByText("Lattice chat")).toBeVisible();
    expect(api.getNativeSessionHandoff).toHaveBeenCalledTimes(1);
    await expect.element(page.getByTestId("continue-in-terminal")).not.toBeInTheDocument();
  });
});

import "../../index.css";

import { ProjectId, ProviderInstanceId, ThreadId } from "@synara/contracts";
import { useState } from "react";
import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const api = vi.hoisted(() => ({
  listFolderSessions: vi.fn(),
  openFolderSession: vi.fn(),
}));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => ({ orchestration: api }) }));

import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import { FolderSessionsMenuGroup } from "./FolderSessionsMenuGroup";

const PROJECT_ID = ProjectId.makeUnsafe("paper");
const recent = new Date(Date.now() - 5 * 60_000).toISOString();

function HistoryMenu(props: { onOpenThread: (threadId: ThreadId) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Menu modal={false} open={open} onOpenChange={setOpen}>
      <MenuTrigger render={<button type="button">History</button>} />
      <ComposerPickerMenuPopup align="start" side="bottom">
        <MenuItem>Lattice chat</MenuItem>
        <FolderSessionsMenuGroup
          projectId={PROJECT_ID}
          open={open}
          onOpenThread={props.onOpenThread}
        />
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listFolderSessions.mockResolvedValue({
    sessions: [
      {
        provider: "claudeAgent",
        providerInstanceId: ProviderInstanceId.makeUnsafe("claudeAgent"),
        externalId: "11111111-1111-4111-8111-111111111111",
        title: "Tighten the abstract",
        updatedAt: recent,
      },
      {
        provider: "codex",
        providerInstanceId: ProviderInstanceId.makeUnsafe("codex"),
        externalId: "22222222-2222-4222-8222-222222222222",
        title: "",
        updatedAt: recent,
      },
    ],
  });
  api.openFolderSession.mockResolvedValue({ threadId: ThreadId.makeUnsafe("continued") });
});

describe("folder sessions in the history menu", () => {
  it("scans the project folder when the menu opens and continues the chosen session", async () => {
    const onOpenThread = vi.fn();
    await render(<HistoryMenu onOpenThread={onOpenThread} />);
    expect(api.listFolderSessions).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "History" }).click();
    expect(api.listFolderSessions).toHaveBeenCalledWith({ projectId: PROJECT_ID });
    await expect.element(page.getByText("From other editors")).toBeVisible();
    await expect.element(page.getByText("Untitled session")).toBeVisible();

    await page.getByRole("menuitem", { name: /Tighten the abstract/ }).click();
    expect(api.openFolderSession).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      provider: "claudeAgent",
      providerInstanceId: "claudeAgent",
      externalId: "11111111-1111-4111-8111-111111111111",
    });
    await vi.waitFor(() => expect(onOpenThread).toHaveBeenCalledWith("continued"));
  });

  it("retries a scan that fails while the menu stays open", async () => {
    api.listFolderSessions
      .mockRejectedValueOnce(new Error("starting"))
      .mockResolvedValueOnce({ sessions: [] })
      .mockResolvedValue({
        sessions: [
          {
            provider: "codex",
            providerInstanceId: ProviderInstanceId.makeUnsafe("codex"),
            externalId: "33333333-3333-4333-8333-333333333333",
            title: "Check the proofs",
            updatedAt: recent,
          },
        ],
      });
    await render(<HistoryMenu onOpenThread={vi.fn()} />);
    await page.getByRole("button", { name: "History" }).click();
    await vi.waitFor(() => expect(api.listFolderSessions).toHaveBeenCalledTimes(2), {
      timeout: 3_000,
    });
    // A successful (empty) answer ends the retries until the menu opens again.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(api.listFolderSessions).toHaveBeenCalledTimes(2);
    await expect.element(page.getByText("From other editors")).not.toBeInTheDocument();
  });

  it("shows no section when the folder has no sessions from other editors", async () => {
    api.listFolderSessions.mockResolvedValue({ sessions: [] });
    await render(<HistoryMenu onOpenThread={vi.fn()} />);
    await page.getByRole("button", { name: "History" }).click();
    await expect.element(page.getByText("Lattice chat")).toBeVisible();
    expect(api.listFolderSessions).toHaveBeenCalledTimes(1);
    await expect.element(page.getByText("From other editors")).not.toBeInTheDocument();
  });
});

import "../../index.css";

import type { ProviderListMcpServersResult } from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const api = vi.hoisted(() => ({
  listMcpServers: vi.fn(),
  runMcpServerAction: vi.fn(),
}));
const openExternalLink = vi.hoisted(() => vi.fn());
vi.mock("../../nativeApi", () => ({ ensureNativeApi: () => ({ provider: api }) }));
vi.mock("~/lib/linkChips", () => ({ openExternalLink }));

import { ComposerMcpDialog } from "./ComposerMcpDialog";

const needsSignIn: ProviderListMcpServersResult = {
  source: "workspace",
  servers: [
    {
      name: "linear",
      status: "needs-auth",
      transport: "http",
      toolCount: null,
      scope: "user",
      endpoint: "https://mcp.linear.app",
      actions: ["authenticate", "reconnect", "disable"],
    },
    {
      name: "broken",
      status: "failed",
      transport: "stdio",
      toolCount: null,
      error: "ENOENT: no such file or directory",
      actions: ["reconnect", "disable"],
    },
    {
      name: "files",
      status: "connected",
      transport: "stdio",
      toolCount: 2,
      endpoint: "node",
      actions: ["reconnect", "disable"],
    },
  ],
};

const signedIn: ProviderListMcpServersResult = {
  source: "workspace",
  servers: [
    {
      name: "linear",
      status: "connected",
      transport: "http",
      toolCount: 23,
      scope: "user",
      endpoint: "https://mcp.linear.app",
      actions: ["sign-out", "reconnect", "disable"],
    },
  ],
};

function renderDialog(provider: "claudeAgent" | "codex" = "claudeAgent") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ComposerMcpDialog
        open
        onOpenChange={vi.fn()}
        provider={provider}
        instanceId={null}
        cwd="/work/paper"
        threadId="thread-1"
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listMcpServers.mockResolvedValue(needsSignIn);
  api.runMcpServerAction.mockResolvedValue({});
});

describe("ComposerMcpDialog", () => {
  it("lists each server's status, tools and error from the runtime's report", async () => {
    await renderDialog();
    await expect.element(page.getByText("Needs sign-in")).toBeVisible();
    await expect.element(page.getByText("HTTP · mcp.linear.app · User")).toBeVisible();
    await expect.element(page.getByText("stdio · node · 2 tools")).toBeVisible();
    await expect.element(page.getByText("ENOENT: no such file or directory")).toBeVisible();
    await expect
      .element(page.getByText("No agent session is running in this thread", { exact: false }))
      .toBeVisible();
    // Opening the view asks the runtime to re-read its config once.
    expect(api.listMcpServers).toHaveBeenCalledWith({
      provider: "claudeAgent",
      cwd: "/work/paper",
      threadId: "thread-1",
      forceReload: true,
    });
  });

  it("opens the provider's sign-in page and watches until the server connects", async () => {
    api.runMcpServerAction.mockResolvedValueOnce({ authUrl: "https://mcp.linear.app/authorize?x" });
    await renderDialog();
    await page.getByRole("button", { name: "Sign in" }).click();
    expect(api.runMcpServerAction).toHaveBeenCalledWith({
      provider: "claudeAgent",
      cwd: "/work/paper",
      threadId: "thread-1",
      serverName: "linear",
      action: "authenticate",
    });
    expect(openExternalLink).toHaveBeenCalledWith("https://mcp.linear.app/authorize?x");
    await expect
      .element(page.getByText("Finish signing in in your browser.", { exact: false }))
      .toBeVisible();
    // The watch asks for the one server being signed in to.
    await expect
      .poll(() => api.listMcpServers.mock.calls.some(([input]) => input.serverName === "linear"))
      .toBe(true);

    const [linear, ...others] = needsSignIn.servers;
    api.listMcpServers.mockResolvedValue({
      ...needsSignIn,
      servers: [
        { ...linear!, status: "connected", toolCount: 23, actions: ["reconnect", "disable"] },
        ...others,
      ],
    });
    await expect.element(page.getByText("HTTP · mcp.linear.app · User · 23 tools")).toBeVisible();
    await expect
      .element(page.getByText("Finish signing in in your browser.", { exact: false }))
      .not.toBeInTheDocument();
  });

  it("shows the empty state with how to add a server", async () => {
    api.listMcpServers.mockResolvedValue({ source: "session", servers: [] });
    await renderDialog();
    await expect.element(page.getByText("No MCP servers are configured.")).toBeVisible();
    await expect
      .element(page.getByText("Add one in Terminal with claude mcp add, then reopen /mcp."))
      .toBeVisible();
  });

  it("signs out only after the row confirms it, and offers sign-in again", async () => {
    api.listMcpServers.mockResolvedValue(signedIn);
    await renderDialog();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect.element(page.getByText("Sign out of linear?")).toBeVisible();
    expect(api.runMcpServerAction).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.element(page.getByText("Sign out of linear?")).not.toBeInTheDocument();
    expect(api.runMcpServerAction).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "Sign out" }).click();
    api.listMcpServers.mockResolvedValue(needsSignIn);
    await page.getByRole("button", { name: "Sign out" }).last().click();
    expect(api.runMcpServerAction).toHaveBeenCalledWith({
      provider: "claudeAgent",
      cwd: "/work/paper",
      threadId: "thread-1",
      serverName: "linear",
      action: "sign-out",
    });
    await expect.element(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  it("gives Codex the Terminal command instead of a sign-out it cannot run", async () => {
    api.listMcpServers.mockResolvedValue(signedIn);
    await renderDialog("codex");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect.element(page.getByText("codex mcp logout linear")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Copy command" })).toBeVisible();
    expect(api.runMcpServerAction).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "Reconnect" }).last().click();
    expect(api.runMcpServerAction).toHaveBeenCalledWith({
      provider: "codex",
      cwd: "/work/paper",
      threadId: "thread-1",
      serverName: "linear",
      action: "reconnect",
    });
  });
});

// The Claude notice above the composer must stay readable in Lattice's narrow agent
// panel: the whole reason shows (it wraps, never truncates), with its next step and a
// dismiss, in English and Chinese. With no agent CLI found it lists what to install and
// offers Set path… and Check again.
import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { setLanguagePreference } from "../../i18n";
import type { ClaudeComposerNotice as Notice } from "./claudeComposerNotice";
import { ComposerClaudeNotice } from "./ComposerClaudeNotice";

const forbidden: Notice = {
  key: "turn-failed:turn-1",
  kind: "turn-failed",
  message:
    "Anthropic 拒绝了这个 Claude 账号或所在网络（403）。重新登录多半没用：请检查账号状态，或换用其他提供商。",
  action: "change-model",
  blocksNextSend: true,
};

describe("ComposerClaudeNotice", () => {
  afterEach(() => setLanguagePreference("en"));

  it("shows the whole reason with its action in a narrow panel", async () => {
    setLanguagePreference("zh-CN");
    await page.viewport(240, 600);
    const onChangeModel = vi.fn();
    const onDismiss = vi.fn();
    const screen = await render(
      <div style={{ width: 220 }}>
        <ComposerClaudeNotice
          notice={forbidden}
          onChangeModel={onChangeModel}
          onOpenProviderSettings={vi.fn()}
          onSetPath={vi.fn()}
          onRecheck={vi.fn(async () => null)}
          onDismiss={onDismiss}
        />
      </div>,
    );
    try {
      const notice = page.getByTestId("composer-claude-notice");
      await expect.element(notice).toHaveAttribute("role", "status");
      const message = page.getByText(forbidden.message).element() as HTMLElement;
      // Wrapped, not cut: no hidden overflow on the reason.
      expect(message.scrollWidth).toBeLessThanOrEqual(message.clientWidth);
      expect(message.getBoundingClientRect().height).toBeGreaterThan(30);

      await page.getByRole("button", { name: "更改模型" }).click();
      expect(onChangeModel).toHaveBeenCalledOnce();
      await page.getByRole("button", { name: "关闭提示" }).click();
      expect(onDismiss).toHaveBeenCalledOnce();
    } finally {
      await screen.unmount();
    }
  });

  it("offers provider settings for a problem fixed there", async () => {
    const onOpenProviderSettings = vi.fn();
    const screen = await render(
      <ComposerClaudeNotice
        notice={{
          ...forbidden,
          kind: "provider-status",
          message: "Claude Code 1.0.100 is too old. Run `claude update` in Terminal.",
          action: "provider-settings",
        }}
        onChangeModel={vi.fn()}
        onOpenProviderSettings={onOpenProviderSettings}
        onSetPath={vi.fn()}
        onRecheck={vi.fn(async () => null)}
        onDismiss={vi.fn()}
      />,
    );
    try {
      await page.getByRole("button", { name: "Provider settings" }).click();
      expect(onOpenProviderSettings).toHaveBeenCalledOnce();
    } finally {
      await screen.unmount();
    }
  });

  const agentSetup = (message: string): Notice => ({
    key: "agent-setup",
    kind: "agent-setup",
    message,
    action: "set-path",
    blocksNextSend: true,
  });

  it("says which agents to install and how, with Set path… and Check again, in Chinese", async () => {
    setLanguagePreference("zh-CN");
    await page.viewport(320, 900);
    const onSetPath = vi.fn();
    let finishCheck: () => void = () => {};
    const onRecheck = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          finishCheck = () => resolve(null);
        }),
    );
    const screen = await render(
      <div style={{ width: 300 }}>
        <ComposerClaudeNotice
          notice={agentSetup("Lattice 找不到 Claude Code 或 Codex")}
          onChangeModel={vi.fn()}
          onOpenProviderSettings={vi.fn()}
          onSetPath={onSetPath}
          onRecheck={onRecheck}
          onDismiss={vi.fn()}
        />
      </div>,
    );
    try {
      const notice = page.getByTestId("composer-claude-notice");
      await expect.element(notice).toHaveAttribute("data-notice-kind", "agent-setup");
      await expect.element(page.getByText("Lattice 找不到 Claude Code 或 Codex")).toBeVisible();
      await expect
        .element(page.getByText("curl -fsSL https://claude.ai/install.sh | bash"))
        .toBeVisible();
      await expect.element(page.getByText("npm install -g @openai/codex")).toBeVisible();
      await expect.element(page.getByText("claude auth login")).toBeVisible();
      await expect.element(page.getByText("codex login")).toBeVisible();
      // Nothing spills out of the narrow panel.
      const box = notice.element() as HTMLElement;
      expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);

      await page.getByRole("button", { name: "设置路径…" }).click();
      expect(onSetPath).toHaveBeenCalledOnce();

      await page.getByRole("button", { name: "再次检查" }).click();
      expect(onRecheck).toHaveBeenCalledOnce();
      await expect.element(page.getByRole("button", { name: "正在检查…" })).toBeDisabled();
      finishCheck();
      await expect.element(page.getByRole("button", { name: "再次检查" })).toBeEnabled();
      await expect.element(page.getByText(/还是没有找到。/)).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("reads the same setup in English", async () => {
    const screen = await render(
      <ComposerClaudeNotice
        notice={agentSetup("Lattice can't find Claude Code or Codex")}
        onChangeModel={vi.fn()}
        onOpenProviderSettings={vi.fn()}
        onSetPath={vi.fn()}
        onRecheck={vi.fn(async () => null)}
        onDismiss={vi.fn()}
      />,
    );
    try {
      await expect.element(page.getByText("Lattice can't find Claude Code or Codex")).toBeVisible();
      await expect.element(page.getByRole("button", { name: "Set path…" })).toBeVisible();
      await expect.element(page.getByRole("button", { name: "Check again" })).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });
});

// The Claude notice above the composer must stay readable in Lattice's narrow agent
// panel: the whole reason shows (it wraps, never truncates), with its next step and a
// dismiss, in English and Chinese.
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
});

import "../../index.css";

import { TurnId } from "@synara/contracts";
import { formatProviderDeliveryBlockDetail } from "@synara/shared/providerDeliveryBlock";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { setLanguagePreference } from "~/i18n";
import { makeActivity } from "~/storeTestFixtures";
import { deriveWorkLogEntries } from "~/workLog";
import { ThreadErrorBanner } from "./ThreadErrorBanner";

const LONG_ERROR = [
  "Provider request failed",
  "Connection closed while waiting for a response",
  "Acceptance could not be confirmed",
  "Additional provider details",
  "Final diagnostic line",
].join("\n");

describe("ThreadErrorBanner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("expands the full multiline error and collapses it accessibly", async () => {
    await render(<ThreadErrorBanner error={LONG_ERROR} />);
    const show = page.getByRole("button", { name: "Show details" });
    await expect.element(show).toHaveAttribute("aria-expanded", "false");
    const detailsId = show.element().getAttribute("aria-controls");
    expect(detailsId).toBeTruthy();

    await show.click();
    const hide = page.getByRole("button", { name: "Hide details" });
    await expect.element(hide).toHaveAttribute("aria-expanded", "true");
    const fullError = document.getElementById(detailsId!)!;
    expect(fullError.textContent).toBe(LONG_ERROR);
    await expect.element(fullError).toBeVisible();
    expect(getComputedStyle(fullError).whiteSpace).toBe("pre-wrap");
    expect(getComputedStyle(fullError).webkitLineClamp).toBe("none");

    await hide.click();
    await expect.element(show).toHaveAttribute("aria-expanded", "false");
    expect(getComputedStyle(fullError).webkitLineClamp).toBe("3");
    // The error text is rendered once, collapsed or expanded.
    expect(page.getByText("Provider request failed", { exact: false }).elements()).toHaveLength(1);
  });

  it("keeps long errors scrollable without widening a narrow pane", async () => {
    const error = `${"x".repeat(500)}\n${Array.from({ length: 30 }, (_, index) => `Detail ${index}`).join("\n")}`;
    await render(
      <div style={{ width: 320 }}>
        <ThreadErrorBanner error={error} onDismiss={() => {}} />
      </div>,
    );
    await page.getByRole("button", { name: "Show details" }).click();
    const detailsId = page
      .getByRole("button", { name: "Hide details" })
      .element()
      .getAttribute("aria-controls");
    const fullError = document.getElementById(detailsId!)!;
    expect(fullError.textContent).toBe(error);
    await expect.poll(() => fullError.clientHeight).toBeGreaterThan(0);
    expect(fullError.scrollHeight).toBeGreaterThan(fullError.clientHeight);
    expect(fullError.scrollWidth).toBeLessThanOrEqual(fullError.clientWidth);
    expect(page.getByRole("alert").element().getBoundingClientRect().width).toBeLessThanOrEqual(
      320,
    );
    fullError.focus();
    expect(document.activeElement).toBe(fullError);
    fullError.scrollTop = fullError.scrollHeight;
    expect(fullError.scrollTop).toBeGreaterThan(0);
  });

  it("copies every line while collapsed and confirms success", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await render(<ThreadErrorBanner error={LONG_ERROR} />);
    await page.getByRole("button", { name: "Copy error", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Copied error" })).toBeVisible();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(LONG_ERROR);
  });

  it("resets details and copy feedback when the error changes", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const screen = await render(<ThreadErrorBanner error={LONG_ERROR} />);
    await page.getByRole("button", { name: "Show details" }).click();
    await page.getByRole("button", { name: "Copy error", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Copied error" })).toBeVisible();

    await screen.rerender(<ThreadErrorBanner error="A different provider error" />);
    // Short errors fit in the collapsed text, so there is nothing to expand.
    await expect.element(page.getByRole("button", { name: /details/ })).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Copy error", exact: true }))
      .toBeVisible();
    await screen.rerender(<ThreadErrorBanner error={null} />);
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  });

  it("only offers existing unblock recovery for quarantine and never resends errors", async () => {
    const onUnblock = vi.fn();
    const onDismiss = vi.fn();
    const screen = await render(
      <ThreadErrorBanner error={LONG_ERROR} onUnblock={onUnblock} onDismiss={onDismiss} />,
    );
    await expect
      .element(page.getByRole("button", { name: "Retry", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Unblock thread" }))
      .not.toBeInTheDocument();

    const quarantine = formatProviderDeliveryBlockDetail("Acceptance is uncertain");
    await screen.rerender(
      <ThreadErrorBanner error={quarantine} onUnblock={onUnblock} onDismiss={onDismiss} />,
    );
    await page.getByRole("button", { name: "Unblock thread" }).click();
    expect(onUnblock).toHaveBeenCalledExactlyOnceWith();
    await screen.rerender(
      <ThreadErrorBanner error={quarantine} onUnblock={onUnblock} unblocking />,
    );
    await expect.element(page.getByRole("button", { name: "Unblocking…" })).toBeDisabled();

    await screen.rerender(<ThreadErrorBanner error={quarantine} onDismiss={onDismiss} />);
    await expect
      .element(page.getByRole("button", { name: "Unblock thread" }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Dismiss error" }).click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onUnblock).toHaveBeenCalledTimes(1);
  });
});

describe("ThreadErrorBanner for a Claude Code exit", () => {
  afterEach(() => {
    setLanguagePreference("en");
    vi.restoreAllMocks();
  });

  // A writer who could only copy "Claude Code process exited with code 1" had
  // nothing to report. The card shows the next step even when its text is
  // clamped in a narrow panel, and Copy error carries the reason and the step.
  it("shows the next step in a narrow panel and copies it with the reason", async () => {
    setLanguagePreference("zh-CN");
    const turnId = TurnId.makeUnsafe("claude-exit-turn");
    const reason =
      "Claude Code process exited with code 1: error: unknown option '--setting-sources=user,project,local'";
    const [entry] = deriveWorkLogEntries(
      [
        makeActivity({
          id: "claude-exit-error",
          turnId,
          sequence: 2,
          kind: "runtime.error",
          tone: "error",
          summary: "Provider runtime error",
          payload: { message: reason, class: "provider_error", errorCode: "claude_cli_outdated" },
        }),
      ],
      turnId,
    );
    const failure = entry!.turnFailure!;
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await render(
      <div style={{ width: 240 }}>
        <ThreadErrorBanner
          title="任务已中断"
          error={failure.message}
          nextStep={failure.nextStep!}
        />
      </div>,
    );
    const nextStep =
      "你安装的 Claude Code 版本太旧，在这里运行不了。请在终端运行 `claude update`（或重装 Claude Code），然后重试。";
    await expect.element(page.getByText(nextStep, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "复制 错误", exact: true }).click();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      `任务因提供商错误而中断，工作尚未完成。${reason}\n${nextStep}`,
    );
  });
});

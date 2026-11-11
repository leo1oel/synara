import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { setLanguagePreference } from "~/i18n";
import { RateLimitBanner } from "./RateLimitBanner";

function firstLineBox(element: Element): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getClientRects()[0]!;
}

describe("RateLimitBanner", () => {
  afterEach(() => {
    setLanguagePreference("en");
  });

  // The embedded Agent panel's viewport is the panel, so a narrow panel sits below the
  // 640px breakpoint where the shared alert action used to drop onto its own row.
  for (const locale of ["en", "zh-CN"] as const) {
    it(`keeps the dismiss button beside the first line in a narrow panel (${locale})`, async () => {
      setLanguagePreference(locale);
      await page.viewport(320, 400);
      const onDismiss = vi.fn();
      await render(
        <RateLimitBanner
          onDismiss={onDismiss}
          rateLimitStatus={{
            status: "allowed_warning",
            utilization: 0.92,
            resetsAt: new Date(Date.now() + 2822 * 60_000).toISOString(),
          }}
        />,
      );

      const alert = page.getByRole("alert").element();
      const description = alert.querySelector("[data-slot=alert-description]")!;
      const button = page.getByRole("button").element();
      const text = description.getBoundingClientRect();
      const line = firstLineBox(description);
      const close = button.getBoundingClientRect();

      // The message wraps at this width, and the button still shares its first row.
      expect(text.height).toBeGreaterThan(line.height * 1.5);
      expect(close.left).toBeGreaterThanOrEqual(text.right);
      const lineCenter = line.top + line.height / 2;
      const closeCenter = close.top + close.height / 2;
      expect(Math.abs(closeCenter - lineCenter)).toBeLessThanOrEqual(2);
      expect(alert.getBoundingClientRect().right).toBeLessThanOrEqual(320);

      await page.getByRole("button").click();
      expect(onDismiss).toHaveBeenCalledOnce();
    });
  }

  it("keeps the dismiss button on the first line at a normal width", async () => {
    await page.viewport(760, 400);
    await render(
      <div style={{ width: 420 }}>
        <RateLimitBanner
          onDismiss={() => {}}
          rateLimitStatus={{
            status: "rejected",
            resetsAt: new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString(),
          }}
        />
      </div>,
    );
    const description = page
      .getByRole("alert")
      .element()
      .querySelector("[data-slot=alert-description]")!;
    expect(description.textContent).toBe("Rate limit reached. Resets in about 3\u00a0days.");
    const line = firstLineBox(description);
    const close = page.getByRole("button", { name: "Dismiss rate limit status" }).element();
    const box = close.getBoundingClientRect();
    expect(Math.abs(box.top + box.height / 2 - (line.top + line.height / 2))).toBeLessThanOrEqual(
      2,
    );
  });
});

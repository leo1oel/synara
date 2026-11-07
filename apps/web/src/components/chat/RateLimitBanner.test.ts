import { afterEach, describe, expect, it } from "vitest";

import { setLanguagePreference, t } from "~/i18n";
import { describeRateLimitReset, formatRateLimitNotice } from "./RateLimitBanner";

const NOW = Date.parse("2026-11-07T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function resetIn(ms: number): string {
  return new Date(NOW + ms).toISOString();
}

describe("describeRateLimitReset", () => {
  it("counts whole minutes under an hour, never zero", () => {
    expect(describeRateLimitReset(0)).toEqual({ unit: "minutes", count: 1 });
    expect(describeRateLimitReset(-5_000)).toEqual({ unit: "minutes", count: 1 });
    expect(describeRateLimitReset(20_000)).toEqual({ unit: "minutes", count: 1 });
    expect(describeRateLimitReset(38 * MINUTE)).toEqual({ unit: "minutes", count: 38 });
    expect(describeRateLimitReset(HOUR - 1)).toEqual({ unit: "minutes", count: 60 });
  });

  it("rounds to hours from one hour up to two days", () => {
    expect(describeRateLimitReset(HOUR)).toEqual({ unit: "hours", count: 1 });
    expect(describeRateLimitReset(90 * MINUTE)).toEqual({ unit: "hours", count: 2 });
    // The reported notice: 2822 minutes is about 47 hours.
    expect(describeRateLimitReset(2822 * MINUTE)).toEqual({ unit: "hours", count: 47 });
    expect(describeRateLimitReset(2 * DAY - 1)).toEqual({ unit: "hours", count: 48 });
  });

  it("rounds to days from two days on", () => {
    expect(describeRateLimitReset(2 * DAY)).toEqual({ unit: "days", count: 2 });
    expect(describeRateLimitReset(6 * DAY + 13 * HOUR)).toEqual({ unit: "days", count: 7 });
  });
});

describe("formatRateLimitNotice", () => {
  afterEach(() => {
    setLanguagePreference("en");
  });

  it("writes the notice in English with human reset units", () => {
    setLanguagePreference("en");
    expect(
      formatRateLimitNotice(
        t,
        { status: "allowed_warning", utilization: 0.92, resetsAt: resetIn(2822 * MINUTE) },
        NOW,
      ),
    ).toBe("Approaching rate limit (92% used). Resets in about 47\u00a0h.");
    expect(
      formatRateLimitNotice(t, { status: "rejected", resetsAt: resetIn(38 * MINUTE) }, NOW),
    ).toBe("Rate limit reached. Resets in 38\u00a0min.");
    expect(
      formatRateLimitNotice(t, { status: "rejected", resetsAt: resetIn(1 * DAY + HOUR) }, NOW),
    ).toBe("Rate limit reached. Resets in about 25\u00a0h.");
    expect(
      formatRateLimitNotice(t, { status: "allowed_warning", resetsAt: resetIn(3 * DAY) }, NOW),
    ).toBe("Approaching rate limit. Resets in about 3\u00a0days.");
    expect(formatRateLimitNotice(t, { status: "rejected" }, NOW)).toBe("Rate limit reached.");
    expect(formatRateLimitNotice(t, { status: "rejected", resetsAt: "not a date" }, NOW)).toBe(
      "Rate limit reached.",
    );
  });

  it("writes the whole notice in Chinese for zh-CN", () => {
    setLanguagePreference("zh-CN");
    expect(
      formatRateLimitNotice(
        t,
        { status: "allowed_warning", utilization: 0.92, resetsAt: resetIn(2822 * MINUTE) },
        NOW,
      ),
    ).toBe("即将达到速率限制（已用 92%）。约 47 小时后重置。");
    expect(
      formatRateLimitNotice(t, { status: "rejected", resetsAt: resetIn(38 * MINUTE) }, NOW),
    ).toBe("已达到速率限制。38 分钟后重置。");
    expect(
      formatRateLimitNotice(t, { status: "allowed_warning", resetsAt: resetIn(3 * DAY) }, NOW),
    ).toBe("即将达到速率限制。约 3 天后重置。");
    expect(formatRateLimitNotice(t, { status: "rejected" }, NOW)).toBe("已达到速率限制。");
  });
});

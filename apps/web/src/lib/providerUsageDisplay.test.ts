import { setupI18n } from "@lingui/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messages as zhMessages } from "~/locales/zh-CN/messages.po";

import {
  deriveProviderUsageDisplayRows,
  localizeProviderUsageDisplayText,
  localizeProviderUsageNotice,
  providerUsagePaceDetails,
  selectPrimaryProviderUsageDisplayRow,
} from "./providerUsageDisplay";

describe("providerUsageDisplay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("selects the most constrained display row for compact header chips", () => {
    const rows = deriveProviderUsageDisplayRows([
      {
        provider: "claudeAgent",
        updatedAt: "2099-04-08T18:00:00.000Z",
        limits: [
          {
            window: "5h",
            usedPercent: 7,
            resetsAt: "2099-04-08T20:00:00.000Z",
            windowDurationMins: 300,
          },
          {
            window: "Weekly",
            usedPercent: 84,
            resetsAt: "2099-04-14T18:00:00.000Z",
            windowDurationMins: 10080,
          },
        ],
      },
    ]);

    const primary = selectPrimaryProviderUsageDisplayRow(rows);

    expect(primary?.label).toBe("Weekly");
    expect(primary?.remainingLabel).toBe("16%");
    expect(primary?.remainingTone).toBe("warning");
  });

  it("centralizes reserve and eta details for display rows", () => {
    vi.setSystemTime("2026-06-09T12:00:00.000Z");

    const [row] = deriveProviderUsageDisplayRows([
      {
        provider: "codex",
        updatedAt: "2026-06-09T12:00:00.000Z",
        limits: [
          {
            window: "5h",
            usedPercent: 15,
            resetsAt: "2026-06-09T12:36:00.000Z",
            windowDurationMins: 300,
          },
        ],
      },
    ]);

    expect(row ? providerUsagePaceDetails(row) : null).toEqual({
      amountText: "73% in reserve",
      etaText: "Lasts until reset",
    });
  });

  it("infers standard window durations from normalized labels for pace details", () => {
    vi.setSystemTime("2026-06-09T12:00:00.000Z");

    const [row] = deriveProviderUsageDisplayRows([
      {
        provider: "codex",
        updatedAt: "2026-06-09T12:00:00.000Z",
        limits: [
          {
            window: "5h",
            usedPercent: 9,
            resetsAt: "2026-06-09T15:00:00.000Z",
          },
        ],
      },
    ]);

    expect(row?.markerPercent).toBe(60);
    expect(row ? providerUsagePaceDetails(row) : null).toEqual({
      amountText: "31% in reserve",
      etaText: "Lasts until reset",
    });
  });

  it("localizes provider usage labels, countdowns, and pace details in Chinese", () => {
    vi.setSystemTime("2026-06-09T12:00:00.000Z");
    const i18n = setupI18n();
    i18n.loadAndActivate({ locale: "zh-CN", messages: zhMessages });
    const [row] = deriveProviderUsageDisplayRows([
      {
        provider: "codex",
        updatedAt: "2026-06-09T12:00:00.000Z",
        limits: [
          {
            window: "5h",
            usedPercent: 15,
            resetsAt: "2026-06-09T12:36:00.000Z",
            windowDurationMins: 300,
          },
        ],
      },
    ]);

    expect(row ? localizeProviderUsageDisplayText(i18n, row) : null).toEqual({
      label: "5 小时",
      leftText: "剩余 85%",
      resetText: "将在 36 分钟后重置",
      progressLabel: "5 小时剩余额度",
      paceTitle: "使用进度：低于预期",
      paceDetails: {
        amountText: "比预期少用 73%",
        etaText: "预计可用到重置",
      },
    });
    expect(
      localizeProviderUsageNotice(
        i18n,
        "Anthropic is rate-limiting usage checks — showing your last values, retrying in ~2m. Manual refreshes only extend the limit.",
      ),
    ).toBe(
      "Anthropic 正在限制用量查询频率——当前显示的是上次获取的数据，约 2 分钟后重试。手动刷新只会延长限流时间。",
    );
  });
});

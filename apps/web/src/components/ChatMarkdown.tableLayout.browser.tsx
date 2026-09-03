// FILE: ChatMarkdown.tableLayout.browser.tsx
// Purpose: Keeps wide assistant tables readable inside narrow chat panels.
// Layer: Web chat browser test

import "../index.css";

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

import ChatMarkdown from "./ChatMarkdown";

const WIDE_TABLE = [
  "| 项目名称 | 当前状态 | 负责人 | 下一步操作 |",
  "| --- | --- | --- | --- |",
  "| 研究计划与实验设计 | 正在进行详细分析 | 张三 | 完成结果复核并提交报告 |",
].join("\n");

describe("ChatMarkdown table layout", () => {
  afterEach(() => {
    delete document.documentElement.dataset.synaraEmbed;
    document.body.innerHTML = "";
  });

  it("scrolls a wide table instead of squeezing its columns to the panel width", async () => {
    await render(
      <div style={{ width: 280 }}>
        <ChatMarkdown text={WIDE_TABLE} cwd={undefined} isStreaming={false} />
      </div>,
    );

    const scrollRegion = document.querySelector<HTMLElement>(".chat-markdown-table-scroll");
    const cells = [
      ...document.querySelectorAll<HTMLElement>(".chat-markdown th, .chat-markdown td"),
    ];

    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion!.scrollWidth).toBeGreaterThan(scrollRegion!.clientWidth);
    expect(
      Math.min(...cells.map((cell) => cell.getBoundingClientRect().width)),
    ).toBeGreaterThanOrEqual(127);
  });

  it("keeps an inset horizontal scrollbar visible in the embedded Agent", async () => {
    document.documentElement.dataset.synaraEmbed = "true";
    await render(
      <div style={{ width: 280 }}>
        <ChatMarkdown text={WIDE_TABLE} cwd={undefined} isStreaming={false} />
      </div>,
    );

    const scrollRegion = document.querySelector<HTMLElement>(".chat-markdown-table-scroll");
    expect(scrollRegion).not.toBeNull();
    expect(window.getComputedStyle(scrollRegion!).paddingBottom).toBe("4px");

    const thumbStyle = window.getComputedStyle(scrollRegion!, "::-webkit-scrollbar-thumb");
    expect(thumbStyle.backgroundColor).not.toBe("transparent");
    expect(thumbStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  });
});

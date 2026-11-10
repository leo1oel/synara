// FILE: ChatMarkdown.tableLayout.browser.tsx
// Purpose: Keeps wide assistant tables readable inside narrow chat panels.
// Layer: Web chat browser test

import "../index.css";

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

import ChatMarkdown from "./ChatMarkdown";

const WIDE_TABLE = [
  "| 项目名称 | 当前状态 | 负责人 | 下一步操作 |",
  "| --- | --- | --- | --- |",
  "| 研究计划与实验设计 | 正在进行详细分析 | 张三 | 完成结果复核并提交报告 |",
].join("\n");

const WIDE_CODE = `\`\`\`text\n${"wide-code-line ".repeat(24)}\n\`\`\``;
const WIDE_MATH = `$$\n${Array.from({ length: 24 }, (_, index) => `x_{${index}}`).join(" + ")} = y\n$$`;
const PROSE = Array.from({ length: 24 }, (_, index) => `Paragraph ${index}.`).join("\n\n");

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

  // Playwright cannot send a trackpad gesture's phases, so the wheel checks
  // below pass with or without the bug. The style check is the guard: in
  // WebKit a horizontal scroller with overscroll-behavior-x other than auto
  // takes a whole trackpad swipe whose first movement leans toward an edge it
  // rests on, so a vertical swipe over a wide table stopped scrolling the chat.
  it("leaves vertical wheel scrolling over wide tables, code and math to the transcript", async () => {
    document.documentElement.dataset.synaraEmbed = "true";
    await render(
      <div data-testid="transcript" style={{ width: 280, height: 320, overflowY: "auto" }}>
        <ChatMarkdown
          text={[PROSE, WIDE_TABLE, WIDE_CODE, WIDE_MATH, PROSE].join("\n\n")}
          cwd={undefined}
          isStreaming={false}
        />
      </div>,
    );
    // Highlighting replaces the plain code fallback; measure the final block.
    await vi.waitFor(() => {
      expect(document.querySelector(".katex-display")).not.toBeNull();
      expect(document.querySelector(".chat-markdown pre.shiki")).not.toBeNull();
    });
    const transcript = document.querySelector<HTMLElement>("[data-testid='transcript']")!;
    const scrollers = [
      document.querySelector<HTMLElement>(".chat-markdown-table-scroll")!,
      document.querySelector<HTMLElement>(".chat-markdown pre.shiki")!,
      document.querySelector<HTMLElement>(".chat-markdown .katex-display")!,
    ];

    for (const scroller of scrollers) {
      expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
      const style = window.getComputedStyle(scroller);
      expect([style.overscrollBehaviorX, style.overscrollBehaviorY]).toEqual(["auto", "auto"]);

      scroller.scrollIntoView({ block: "center" });
      const top = transcript.scrollTop;
      await userEvent.wheel(scroller, { delta: { y: 60 } });
      await vi.waitFor(() => expect(transcript.scrollTop).toBeGreaterThan(top));

      await userEvent.wheel(scroller, { delta: { x: 60 } });
      await vi.waitFor(() => expect(scroller.scrollLeft).toBeGreaterThan(0));
    }
  });
});

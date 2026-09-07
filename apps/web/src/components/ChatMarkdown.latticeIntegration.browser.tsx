import "../index.css";

import { render } from "vitest-browser-react";
import { afterEach, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ openExternalLink: vi.fn() }));
vi.mock("../lib/linkChips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/linkChips")>()),
  openExternalLink: host.openExternalLink,
}));
vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

import ChatMarkdown from "./ChatMarkdown";

afterEach(() => {
  delete document.documentElement.dataset.synaraEmbed;
  host.openExternalLink.mockClear();
});

it("preserves Lattice math, table scrolling and host links while prose streams", async () => {
  document.documentElement.dataset.synaraEmbed = "true";
  const text = [
    "## 实验结果",
    "",
    "模型满足 \\(E = mc^2\\)，详细说明见 [研究资料](https://example.com/research)。",
    "",
    "| 项目名称 | 当前状态 | 下一步操作 |",
    "| --- | --- | --- |",
    "| 研究计划与实验设计 | 正在进行详细分析 | 完成结果复核并提交报告 |",
    "",
    "```javascript\nconst answer = 42;\n```",
    "",
    "结果分析正在生成。",
  ].join("\n");
  const view = (content: string) => (
    <div style={{ width: 360, padding: 16 }}>
      <ChatMarkdown text={content} cwd={undefined} isStreaming />
    </div>
  );
  const screen = await render(view(text));
  await expect.poll(() => document.querySelector(".katex")).not.toBeNull();
  await screen.getByRole("button", { name: "Enable soft wrap" }).click();
  const code = document.querySelector(".chat-markdown-codeblock");
  const table = document.querySelector<HTMLElement>(".chat-markdown-table-scroll")!;
  expect(table.scrollWidth).toBeGreaterThan(table.clientWidth);
  table.scrollLeft = table.scrollWidth - table.clientWidth;
  const scrollLeft = table.scrollLeft;
  await screen.rerender(view(`${text} 新增内容不应重置代码块或表格。`));
  expect(document.querySelector(".chat-markdown-codeblock")).toBe(code);
  expect(code?.getAttribute("data-wrap")).toBe("true");
  expect(document.querySelector(".chat-markdown-table-scroll")).toBe(table);
  expect(table.scrollLeft).toBe(scrollLeft);
  await screen.getByRole("link", { name: "研究资料" }).click();
  expect(host.openExternalLink).toHaveBeenCalledExactlyOnceWith("https://example.com/research");
  await screen.unmount();
});

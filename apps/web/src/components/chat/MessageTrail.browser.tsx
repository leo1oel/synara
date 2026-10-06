import "../../index.css";

import { type MessageId } from "@synara/contracts";
import { page } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { MessageTrail } from "./MessageTrail";
import { createActiveTrailStore } from "./messageTrail.logic";
import {
  CHAT_COLUMN_FRAME_CLASS_NAME,
  CHAT_COLUMN_GUTTER_CLASS_NAME,
} from "./composerPickerStyles";

afterEach(() => {
  delete document.documentElement.dataset.synaraEmbed;
  document.documentElement.style.removeProperty("--app-chat-max-width");
  document.documentElement.style.removeProperty("--color-text-foreground");
});

it("only shows navigation when the selected transcript width leaves a clear gutter", async () => {
  await page.viewport(1500, 700);
  document.documentElement.dataset.synaraEmbed = "true";
  document.documentElement.style.setProperty("--app-chat-max-width", "72rem");
  // The production theme hook supplies this token; this isolated fixture has no app shell.
  document.documentElement.style.setProperty("--color-text-foreground", "#252525");
  await render(
    <div data-testid="pane" className="relative" style={{ width: 1000, height: 500 }}>
      <div className={CHAT_COLUMN_GUTTER_CLASS_NAME}>
        <div data-testid="column" className={CHAT_COLUMN_FRAME_CLASS_NAME}>
          {Array.from({ length: 10 }, (_, index) => (
            <p key={index} style={{ paddingBlock: 12 }}>
              视觉编码与语言预测：保留视觉特征，还需要有效的内部连接。这段正文不应与左侧的聊天导航重叠。
            </p>
          ))}
        </div>
      </div>
      <MessageTrail
        items={Array.from({ length: 24 }, (_, index) => ({
          id: `message-${index}` as MessageId,
          ordinal: index + 1,
          preview: `研究讨论 ${index + 1}`,
          responsePreview: "分析实验结果与论文结构。",
          attachmentCount: 0,
        }))}
        activeStore={createActiveTrailStore()}
        onSelect={() => {}}
      />
    </div>,
  );
  const pane = document.querySelector<HTMLElement>('[data-testid="pane"]')!;
  const rail = document.querySelector<HTMLElement>('nav[aria-label="Message navigation"]')!;
  const column = document.querySelector<HTMLElement>('[data-testid="column"]')!;
  await expect.poll(() => rail.getAttribute("aria-hidden")).toBe("true");
  // Let the initial ResizeObserver run before asserting the reported regression.
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(rail.getAttribute("aria-hidden")).toBe("true");

  pane.style.width = "1280px";
  await expect.poll(() => rail.getAttribute("aria-hidden")).toBe("false");
  await expect.poll(() => getComputedStyle(rail).opacity).toBe("1");
  expect(
    column.getBoundingClientRect().left - rail.getBoundingClientRect().right,
  ).toBeGreaterThanOrEqual(8);
  await page.screenshot({
    path: "__screenshots__/message-trail-wide.png",
  });

  pane.style.width = "1278px";
  await expect.poll(() => rail.getAttribute("aria-hidden")).toBe("true");
  document.documentElement.style.setProperty("--app-chat-max-width", "46rem");
  pane.style.width = "864px";
  await expect.poll(() => rail.getAttribute("aria-hidden")).toBe("false");
  // Changing the width preference without resizing the pane must also remeasure.
  document.documentElement.style.setProperty("--app-chat-max-width", "100%");
  await expect.poll(() => rail.getAttribute("aria-hidden")).toBe("true");
  pane.style.width = "1400px";
  await expect.poll(() => getComputedStyle(rail).opacity).toBe("0");
  expect(rail.getAttribute("aria-hidden")).toBe("true");
  await page.screenshot({ path: "__screenshots__/message-trail-full.png" });
});

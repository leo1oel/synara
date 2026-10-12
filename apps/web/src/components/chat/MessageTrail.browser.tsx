import "../../index.css";

import { MessageId } from "@synara/contracts";
import { page } from "vitest/browser";
import { Profiler } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { MessageTrail } from "./MessageTrail";
import { createActiveTrailStore, type MessageTrailItem } from "./messageTrail.logic";
import {
  CHAT_COLUMN_FRAME_CLASS_NAME,
  CHAT_COLUMN_GUTTER_CLASS_NAME,
} from "./composerPickerStyles";

const items: MessageTrailItem[] = Array.from({ length: 1_000 }, (_, index) => ({
  id: MessageId.makeUnsafe(`message-${index}`),
  ordinal: index + 1,
  preview: `Question ${index + 1}`,
  responsePreview: `Answer ${index + 1}`,
  attachmentCount: 0,
}));

function rail() {
  return document.querySelector<HTMLElement>('nav[aria-label="Message navigation"]')!;
}

function viewport() {
  return rail().firstElementChild as HTMLDivElement;
}

function frame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

beforeEach(() => {
  document.documentElement.style.setProperty("--color-text-foreground", "#202020");
});

afterEach(() => {
  delete document.documentElement.dataset.synaraEmbed;
  document.documentElement.style.removeProperty("--app-chat-max-width");
  document.documentElement.style.removeProperty("--color-text-foreground");
  document.body.innerHTML = "";
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
          id: MessageId.makeUnsafe(`message-${index}`),
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

it("bounds the mounted rail while keyboard and scroll can reach every history message", async () => {
  await page.viewport(1_440, 900);
  const selected: MessageId[] = [];
  const screen = await render(
    <div style={{ position: "relative", width: 1_400, height: 600 }}>
      <MessageTrail
        items={items}
        activeStore={createActiveTrailStore()}
        onSelect={(id) => selected.push(id)}
      />
    </div>,
  );
  try {
    await expect.poll(() => rail().getAttribute("aria-hidden")).toBe("false");
    await expect.poll(() => getComputedStyle(rail()).opacity).toBe("1");
    await expect.poll(() => rail().querySelectorAll("button").length > 10).toBe(true);
    expect(rail().querySelectorAll("button").length).toBeLessThan(100);
    expect(viewport().scrollHeight).toBe(10_014);
    rail().querySelector<HTMLButtonElement>('button[tabindex="0"]')!.focus();
    rail().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await expect
      .poll(() => document.activeElement?.getAttribute("aria-label"))
      .toBe("Message 1000: Question 1000");
    rail().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(selected).toEqual([MessageId.makeUnsafe("message-999")]);
    expect(rail().querySelectorAll("button").length).toBeLessThan(100);
    expect(viewport().scrollTop).toBeGreaterThan(9_000);
    rail().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    await expect
      .poll(() => document.activeElement?.getAttribute("aria-label"))
      .toBe("Message 999: Question 999");
    rail().dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await expect
      .poll(() => document.activeElement?.getAttribute("aria-label"))
      .toBe("Message 1: Question 1");
    expect(viewport().scrollTop).toBe(0);
    rail().dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await frame();
    rail().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(rail().contains(document.activeElement)).toBe(false);
    viewport().scrollTop = 5_000;
    viewport().dispatchEvent(new Event("scroll", { bubbles: true }));
    await expect
      .poll(() => rail().querySelector('button[aria-label="Message 501: Question 501"]') !== null)
      .toBe(true);
    expect(rail().contains(document.activeElement)).toBe(false);
    const rect = viewport().getBoundingClientRect();
    viewport().dispatchEvent(new MouseEvent("click", { clientY: rect.top + 12, bubbles: true }));
    expect(selected.at(-1)).toBe(MessageId.makeUnsafe("message-500"));
  } finally {
    await screen.unmount();
  }
});

it("redraws a scrolled window under a stationary pointer without React pointer frames", async () => {
  await page.viewport(1_440, 900);
  let commits = 0;
  let emitAudio: ((level: number) => void) | undefined;
  const screen = await render(
    <Profiler id="rail" onRender={() => commits++}>
      <div style={{ position: "relative", width: 1_400, height: 600 }}>
        <MessageTrail
          items={items}
          activeStore={createActiveTrailStore()}
          onSelect={() => {}}
          subscribeAudioLevel={(listener) => {
            emitAudio = listener;
            return () => {
              emitAudio = undefined;
            };
          }}
        />
      </div>
    </Profiler>,
  );
  try {
    await expect.poll(() => emitAudio !== undefined).toBe(true);
    await expect.poll(() => getComputedStyle(rail()).opacity).toBe("1");
    await page.getByRole("button", { name: "Message 1: Question 1", exact: true }).hover();
    await expect
      .poll(
        () =>
          rail().querySelector<HTMLButtonElement>('button[aria-label="Message 1: Question 1"]')
            ?.style.width,
      )
      .toBe("30px");
    viewport().scrollTop = 5_000;
    viewport().dispatchEvent(new Event("scroll", { bubbles: true }));
    await expect
      .poll(() => rail().querySelector('button[aria-label="Message 501: Question 501"]') !== null)
      .toBe(true);
    await expect
      .poll(() => rail().querySelector('[role="tooltip"]')?.textContent)
      .toContain("Question 501");
    const focused = rail().querySelector<HTMLButtonElement>(
      'button[aria-label="Message 501: Question 501"]',
    )!;
    // Scrolling mounts fresh ticks without another pointer event to style them.
    await expect.poll(() => Number.parseFloat(focused.style.width)).toBe(30);
    expect(rail().querySelectorAll("button").length).toBeLessThan(100);
    await frame();
    const before = commits;
    const rect = viewport().getBoundingClientRect();
    for (let index = 0; index < 20; index++) {
      viewport().dispatchEvent(
        new PointerEvent("pointermove", {
          pointerType: "mouse",
          clientY: rect.top + 12,
          bubbles: true,
        }),
      );
      await frame();
    }
    expect(Number.parseFloat(focused.style.width)).toBe(30);
    expect(rail().querySelector('[role="tooltip"]')?.textContent).toContain("Question 501");
    expect(commits).toBe(before);
    viewport().dispatchEvent(
      new PointerEvent("pointerout", {
        pointerType: "mouse",
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
    expect(Number.parseFloat(focused.style.width)).toBe(6);
    emitAudio?.(0.8);
    await frame();
    await frame();
    expect(
      [...rail().querySelectorAll<HTMLButtonElement>("button")].some(
        (button) => Number.parseFloat(button.style.width) > 6,
      ),
    ).toBe(true);
  } finally {
    await screen.unmount();
  }
});

it("keeps the rail settled when a native resize notification repeats unchanged bounds", async () => {
  await page.viewport(1_440, 900);
  const NativeResizeObserver = window.ResizeObserver;
  let viewportObserver: ResizeObserver | undefined;
  let viewportNotifications = 0;
  window.ResizeObserver = class extends NativeResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      super((entries, observer) => {
        if (entries.some((entry) => entry.target === rail()?.firstElementChild)) {
          viewportObserver = observer;
          viewportNotifications++;
        }
        callback(entries, observer);
      });
    }
  };
  let commits = 0;
  const screen = await render(
    <Profiler id="rail-resize" onRender={() => commits++}>
      <div style={{ position: "relative", width: 1_400, height: 600 }}>
        <MessageTrail items={items} activeStore={createActiveTrailStore()} onSelect={() => {}} />
      </div>
    </Profiler>,
  );
  try {
    await expect.poll(() => viewportNotifications).toBeGreaterThan(0);
    await expect.poll(() => getComputedStyle(rail()).opacity).toBe("1");
    await frame();
    await frame();
    const bounds = { scrollTop: viewport().scrollTop, height: viewport().clientHeight };
    expect(bounds.height).toBeGreaterThan(0);
    const before = commits;
    const notificationsBefore = viewportNotifications;
    // Re-observation produces a real browser notification for the same box;
    // no synthetic resize callback or changed layout is supplied by the test.
    viewportObserver!.unobserve(viewport());
    viewportObserver!.observe(viewport());
    await expect.poll(() => viewportNotifications).toBeGreaterThan(notificationsBefore);
    await frame();
    await frame();
    expect({ scrollTop: viewport().scrollTop, height: viewport().clientHeight }).toEqual(bounds);
    expect(commits).toBe(before);
  } finally {
    await screen.unmount();
    window.ResizeObserver = NativeResizeObserver;
  }
});

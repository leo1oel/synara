// FILE: TranscriptSelectionAction.browser.tsx
// Purpose: Verifies transcript selection actions stay out of multi-click gestures and remain compact.
// Layer: Browser UI test

import "../../index.css";

import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { TranscriptSelectionAction } from "./TranscriptSelectionAction";
import { TranscriptSelectionActionLayer } from "./TranscriptSelectionActionLayer";
import { useTranscriptAssistantSelectionAction } from "./useTranscriptAssistantSelectionAction";

const NOOP = () => {};

function SelectionHarness() {
  const composerImagesRef = useRef<readonly []>([]);
  const composerFilesRef = useRef<readonly []>([]);
  const composerAssistantSelectionsRef = useRef<readonly []>([]);
  const selectionAction = useTranscriptAssistantSelectionAction({
    threadId: "thread-selection-action",
    enabled: true,
    composerImagesRef,
    composerFilesRef,
    composerAssistantSelectionsRef,
    addComposerAssistantSelectionToDraft: () => true,
    scheduleComposerFocus: NOOP,
    onMessagesClickCaptureBase: NOOP,
    onMessagesPointerCancelBase: NOOP,
    onMessagesPointerDownBase: NOOP,
    onMessagesPointerUpBase: NOOP,
    onMessagesScrollBase: NOOP,
    onMessagesTouchEndBase: NOOP,
    onMessagesTouchMoveBase: NOOP,
    onMessagesTouchStartBase: NOOP,
    onMessagesWheelBase: NOOP,
  });

  return (
    <>
      <div
        data-testid="messages"
        onClickCapture={selectionAction.onMessagesClickCapture}
        onMouseUp={selectionAction.onMessagesMouseUp}
        onPointerCancel={selectionAction.onMessagesPointerCancel}
        onPointerDown={selectionAction.onMessagesPointerDown}
        onPointerUp={selectionAction.onMessagesPointerUp}
        onScroll={selectionAction.onMessagesScroll}
        onTouchEnd={selectionAction.onMessagesTouchEnd}
        onTouchMove={selectionAction.onMessagesTouchMove}
        onTouchStart={selectionAction.onMessagesTouchStart}
        onWheel={selectionAction.onMessagesWheel}
      >
        <p data-assistant-message-id="assistant-message-1">Alpha beta gamma delta</p>
      </div>
      <TranscriptSelectionActionLayer
        action={selectionAction.pendingTranscriptSelectionAction}
        showMarkerActions={false}
        onHighlight={NOOP}
        onUnderline={NOOP}
        onAddToChat={selectionAction.commitTranscriptAssistantSelection}
      />
    </>
  );
}

function selectBeta(container: HTMLElement): void {
  const textNode = container.querySelector("[data-assistant-message-id]")?.firstChild;
  if (!(textNode instanceof Text)) {
    throw new Error("Assistant message text node was not rendered.");
  }
  const range = document.createRange();
  range.setStart(textNode, 6);
  range.setEnd(textNode, 10);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

async function settleFrames(): Promise<void> {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

describe("TranscriptSelectionAction", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("stays hidden between clicks while a multi-click selection can continue", async () => {
    const screen = await render(<SelectionHarness />);
    const messages = screen.container.querySelector<HTMLElement>("[data-testid='messages']");
    expect(messages).not.toBeNull();
    selectBeta(messages!);

    messages!.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        button: 0,
        clientX: 120,
        clientY: 80,
        detail: 2,
      }),
    );
    await settleFrames();

    expect(screen.container.querySelector('[data-transcript-selection-action="true"]')).toBeNull();
    await vi.waitFor(() => {
      expect(
        screen.container.querySelector('[data-transcript-selection-action="true"]'),
      ).not.toBeNull();
    });

    await screen.unmount();
  });

  it("cancels the delayed action when the next selection click starts", async () => {
    const screen = await render(<SelectionHarness />);
    const messages = screen.container.querySelector<HTMLElement>("[data-testid='messages']");
    const assistantMessage = messages?.querySelector<HTMLElement>("[data-assistant-message-id]");
    expect(messages).not.toBeNull();
    expect(assistantMessage).not.toBeNull();
    selectBeta(messages!);

    messages!.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        button: 0,
        clientX: 120,
        clientY: 80,
        detail: 2,
      }),
    );
    await settleFrames();
    assistantMessage!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 300));
    await settleFrames();

    expect(screen.container.querySelector('[data-transcript-selection-action="true"]')).toBeNull();

    await screen.unmount();
  });

  it("renders the embedded Add to chat action as a compact non-pill control", async () => {
    const screen = await render(
      <TranscriptSelectionAction left={120} top={80} placement="top" onAddToChat={NOOP} />,
    );
    const toolbar = screen.container.querySelector<HTMLElement>("[role='toolbar'] > div");
    const button = screen.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add to chat"]',
    );
    expect(toolbar).not.toBeNull();
    expect(button).not.toBeNull();

    const toolbarRect = toolbar!.getBoundingClientRect();
    expect(button!.getBoundingClientRect().height).toBe(24);
    expect(Number.parseFloat(getComputedStyle(toolbar!).borderTopLeftRadius)).toBeLessThan(
      toolbarRect.height / 2,
    );

    await screen.unmount();
  });
});

// FILE: ComposerDrawnCaretPlugin.browser.tsx
// Purpose: Verifies the drawn composer caret sits at glyph height on every line,
//          including the empty composer, and gives way to selections and IME.
// Layer: Browser UI test

import "../index.css";

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import {
  ComposerDrawnCaretPlugin,
  readComposerCaretRect,
  shouldDrawComposerCaret,
} from "./ComposerDrawnCaretPlugin";

const WKWEBVIEW_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";

function Editor() {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "composer-drawn-caret-test",
        onError: (error) => {
          throw error;
        },
      }}
    >
      <div className="relative" style={{ width: 220 }}>
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              data-testid="editor"
              className="block w-full whitespace-pre-wrap break-words [&_p]:m-0"
              style={{ fontSize: 14, lineHeight: 1.625, fontFamily: "system-ui, sans-serif" }}
            />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ComposerDrawnCaretPlugin />
      </div>
    </LexicalComposer>
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
  await nextFrame();
  await nextFrame();
}

async function mount() {
  await render(<Editor />);
  await settle();
  return elements();
}

function elements() {
  const editor = document.querySelector<HTMLElement>('[data-testid="editor"]')!;
  const caret = document.querySelector<HTMLElement>('[data-testid="composer-drawn-caret"]')!;
  return { editor, caret };
}

function lineHeightPx(editor: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(editor).lineHeight);
}

function expectCaretAtSelection() {
  const { editor, caret } = elements();
  const expected = readComposerCaretRect(window.getSelection()!.getRangeAt(0))!;
  const drawn = caret.getBoundingClientRect();
  expect(getComputedStyle(caret).display).toBe("block");
  expect(Math.abs(drawn.top - expected.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(drawn.height - expected.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(drawn.left + drawn.width / 2 - expected.left)).toBeLessThanOrEqual(1.5);
  // Glyph height, not the line pitch WebKit's native caret takes on later lines.
  expect(drawn.height).toBeGreaterThan(8);
  expect(drawn.height).toBeLessThan(lineHeightPx(editor) - 2);
}

describe("ComposerDrawnCaretPlugin", () => {
  it("draws only on WebKit engines", () => {
    expect(shouldDrawComposerCaret(WKWEBVIEW_UA)).toBe(true);
    expect(shouldDrawComposerCaret(`${WKWEBVIEW_UA} Version/26.0 Safari/605.1.15`)).toBe(true);
    expect(
      shouldDrawComposerCaret(
        `${WKWEBVIEW_UA.replace("605.1.15", "537.36")} Chrome/142.0.0.0 Electron/39.0.0 Safari/537.36`,
      ),
    ).toBe(false);
    expect(
      shouldDrawComposerCaret(
        `${WKWEBVIEW_UA.replace("605.1.15", "537.36")} Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0`,
      ),
    ).toBe(false);
  });

  it("keeps the caret at glyph height on wrapped, CJK, and empty lines", async () => {
    const { editor, caret } = await mount();
    expect(editor.style.caretColor).toBe("transparent");

    editor.focus();
    await settle();
    // Empty composer: no text to measure, so the caret borrows the <br>'s line.
    expectCaretAtSelection();
    const emptyLeft = caret.getBoundingClientRect().left;
    expect(Math.abs(emptyLeft - editor.getBoundingClientRect().left)).toBeLessThanOrEqual(2);

    await userEvent.keyboard("hello negvqa the quick brown fox jumps over the lazy dog");
    await settle();
    expect(editor.getBoundingClientRect().height).toBeGreaterThan(lineHeightPx(editor) * 1.5);
    expectCaretAtSelection();

    await userEvent.keyboard("{Shift>}{Enter}{/Shift}中文测试 text");
    await settle();
    expectCaretAtSelection();

    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    await settle();
    expectCaretAtSelection();

    await userEvent.keyboard("{End}{Shift>}{Enter}{/Shift}");
    await settle();
    expectCaretAtSelection();
  });

  it("hides for range selections, blur, and IME composition", async () => {
    const { editor, caret } = await mount();
    editor.focus();
    await userEvent.keyboard("negvqa");
    await settle();
    expect(getComputedStyle(caret).display).toBe("block");

    await userEvent.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{/Shift}");
    await settle();
    expect(getComputedStyle(caret).display).toBe("none");

    await userEvent.keyboard("{ArrowRight}");
    await settle();
    expect(getComputedStyle(caret).display).toBe("block");

    editor.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
    await settle();
    expect(getComputedStyle(caret).display).toBe("none");
    expect(editor.style.caretColor).toBe("");
    editor.dispatchEvent(new CompositionEvent("compositionend", { data: "中" }));
    await settle();
    expect(editor.style.caretColor).toBe("transparent");
    expect(getComputedStyle(caret).display).toBe("block");

    editor.blur();
    await settle();
    expect(getComputedStyle(caret).display).toBe("none");
  });
});

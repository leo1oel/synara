// FILE: ComposerDrawnCaretPlugin.tsx
// Purpose: Draws the composer caret at glyph height on WebKit, where the native
//          caret on every line after a block's first is a full line pitch tall.
// Layer: Composer editor plugin
// Exports: ComposerDrawnCaretPlugin, shouldDrawComposerCaret, readComposerCaretRect

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useRef } from "react";

// WebKit sizes a caret from the line's selection rect, whose top is pulled up to the
// previous line's content bottom (contentLogicalTopAdjustedForPrecedingLineBox). Lexical
// keeps a whole message in one <p>, so with the composer's relaxed leading every soft
// wrap or Enter after the first line gets a caret that also spans the gap above it. No
// CSS reaches that geometry, so WebKit hides the native caret and this plugin paints one
// from the collapsed range's glyph rect. Chromium (upstream's Electron) sizes carets
// from the font and keeps its native caret.
export function shouldDrawComposerCaret(userAgent: string): boolean {
  return /AppleWebKit\//.test(userAgent) && !/(Chrome|Chromium|CriOS|Edg)\//.test(userAgent);
}

export interface ComposerCaretRect {
  left: number;
  top: number;
  height: number;
}

function lastSizedRect(rects: DOMRectList): DOMRect | null {
  for (let index = rects.length - 1; index >= 0; index -= 1) {
    const rect = rects[index]!;
    if (rect.height > 0) return rect;
  }
  return null;
}

function firstSizedRect(rects: DOMRectList): DOMRect | null {
  for (const rect of rects) {
    if (rect.height > 0) return rect;
  }
  return null;
}

function nodeClientRects(node: Node): DOMRectList {
  if (node instanceof Element) return node.getClientRects();
  const range = document.createRange();
  range.selectNodeContents(node);
  return range.getClientRects();
}

/**
 * Viewport rect for a collapsed caret, `null` when there is nothing to measure.
 * A caret inside text has a glyph-height rect in both engines. A caret between
 * nodes (an empty line, the empty composer) has none, so it borrows the edge of
 * its neighbour; a `<br>` reports a glyph-height rect at the start of its line.
 */
export function readComposerCaretRect(range: Range): ComposerCaretRect | null {
  const direct = lastSizedRect(range.getClientRects());
  if (direct) return { left: direct.left, top: direct.top, height: direct.height };

  const container = range.startContainer;
  if (container.nodeType !== Node.ELEMENT_NODE) return null;
  const before = container.childNodes[range.startOffset - 1];
  const after = container.childNodes[range.startOffset];
  if (before && before.nodeName !== "BR") {
    const rect = lastSizedRect(nodeClientRects(before));
    if (rect) return { left: rect.right, top: rect.top, height: rect.height };
  }
  if (after) {
    const rect = firstSizedRect(nodeClientRects(after));
    if (rect) return { left: rect.left, top: rect.top, height: rect.height };
  }
  return null;
}

/** Paints the caret into the editor's positioned wrapper while the editor has focus. */
export function ComposerDrawnCaretPlugin() {
  const [editor] = useLexicalComposerContext();
  const caretRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const caret = caretRef.current;
    const wrapper = caret?.parentElement;
    if (!caret || !wrapper) return;
    let rootElement: HTMLElement | null = null;
    let composing = false;
    let frame: number | null = null;
    let lastPosition = "";

    const hide = () => {
      caret.style.display = "none";
      lastPosition = "";
    };

    const paint = () => {
      frame = null;
      const root = rootElement;
      const selection = window.getSelection();
      if (
        !root ||
        composing ||
        document.activeElement !== root ||
        !selection ||
        selection.rangeCount === 0 ||
        !selection.isCollapsed ||
        !root.contains(selection.anchorNode)
      ) {
        hide();
        return;
      }
      const rect = readComposerCaretRect(selection.getRangeAt(0));
      const rootRect = root.getBoundingClientRect();
      // The editor scrolls past max-height; a caret scrolled out of it stays hidden.
      if (
        !rect ||
        rect.top + rect.height / 2 < rootRect.top ||
        rect.top + rect.height / 2 > rootRect.bottom
      ) {
        hide();
        return;
      }
      const wrapperRect = wrapper.getBoundingClientRect();
      const left = Math.round(rect.left - wrapperRect.left - caret.offsetWidth / 2);
      const top = Math.round(rect.top - wrapperRect.top);
      const height = Math.round(rect.height);
      const position = `${left}:${top}:${height}`;
      caret.style.display = "block";
      if (position === lastPosition) return;
      lastPosition = position;
      caret.style.transform = `translate(${left}px, ${top}px)`;
      caret.style.height = `${height}px`;
      // Like the native caret, stay solid while the caret moves and blink once it rests.
      caret.style.animation = "none";
      void caret.offsetWidth;
      caret.style.animation = "";
    };

    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(paint);
    };
    const onCompositionStart = () => {
      // Marked text belongs to the IME; let the native caret and underline show it.
      composing = true;
      if (rootElement) rootElement.style.caretColor = "";
      hide();
    };
    const onCompositionEnd = () => {
      composing = false;
      if (rootElement) rootElement.style.caretColor = "transparent";
      schedule();
    };

    const resizeObserver = new ResizeObserver(schedule);
    const detachRoot = () => {
      if (!rootElement) return;
      rootElement.style.caretColor = "";
      rootElement.removeEventListener("focus", schedule);
      rootElement.removeEventListener("blur", schedule);
      rootElement.removeEventListener("scroll", schedule);
      rootElement.removeEventListener("compositionstart", onCompositionStart);
      rootElement.removeEventListener("compositionend", onCompositionEnd);
      resizeObserver.unobserve(rootElement);
      rootElement = null;
    };
    const unregisterRoot = editor.registerRootListener((nextRoot) => {
      detachRoot();
      rootElement = nextRoot;
      if (nextRoot) {
        nextRoot.style.caretColor = "transparent";
        nextRoot.addEventListener("focus", schedule);
        nextRoot.addEventListener("blur", schedule);
        nextRoot.addEventListener("scroll", schedule);
        nextRoot.addEventListener("compositionstart", onCompositionStart);
        nextRoot.addEventListener("compositionend", onCompositionEnd);
        resizeObserver.observe(nextRoot);
      }
      schedule();
    });
    const unregisterUpdate = editor.registerUpdateListener(schedule);
    document.addEventListener("selectionchange", schedule);
    window.addEventListener("resize", schedule);
    document.fonts?.addEventListener("loadingdone", schedule);

    return () => {
      unregisterRoot();
      unregisterUpdate();
      detachRoot();
      resizeObserver.disconnect();
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("resize", schedule);
      document.fonts?.removeEventListener("loadingdone", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [editor]);

  return (
    <div
      ref={caretRef}
      aria-hidden="true"
      data-testid="composer-drawn-caret"
      className="composer-drawn-caret pointer-events-none absolute top-0 left-0 hidden w-0.5 rounded-full bg-foreground"
    />
  );
}

// FILE: composerEditorRoom.ts
// Purpose: Caps the floating composer's prompt editor at the room its chat column has.
// Layer: Chat composer layout helper
// Exports: composerEditorMaxHeightPx (derive the cap), useComposerEditorRoom (apply it)
//
// The thread composer floats at `bottom-full` of the block under the transcript
// (composerOverlay.ts), so it grows upward. Its editor scrolls inside itself only past a
// fixed 200px, and nothing else bounds it: in a pane shorter than the composer's full
// height (Lattice's Agent panel shares its column with Papers, so it is often 250-400px
// tall) the growing composer ran out of the top of the pane, under the thread header and
// the frame's edge, until little or none of the prompt being typed was visible. A
// narrower pane wraps the same text onto more lines, so it got there with less text.
// The editor's cap is therefore the smaller of 200px and what the column leaves it.

import { useLayoutEffect, type RefObject } from "react";

/** The editor's own cap when the column has room for it (the editor's `max-h` fallback). */
export const COMPOSER_EDITOR_MAX_HEIGHT_PX = 200;
/** Never squeeze the editor below two lines: the line being typed stays readable. */
export const COMPOSER_EDITOR_MIN_HEIGHT_PX = 44;
/** Gap kept between the composer's top edge and the top of its chat column. */
export const COMPOSER_TOP_CLEARANCE_PX = 8;
/** Custom property the editor's `max-h` reads; set on the composer form. */
export const COMPOSER_EDITOR_MAX_HEIGHT_VAR = "--composer-editor-max-height";

/**
 * The editor's cap in px, or null when the column leaves room for the full
 * COMPOSER_EDITOR_MAX_HEIGHT_PX. `editorHeightPx` is the editor's current height and
 * `freeAbovePx` the space between the composer's top edge and the column's top (negative
 * once the composer overflows it): the editor may take its height plus that space, and
 * the sum does not change as the cap applies, so the cap never oscillates.
 */
export function composerEditorMaxHeightPx(input: {
  editorHeightPx: number;
  freeAbovePx: number;
}): number | null {
  const room = Math.floor(input.editorHeightPx + input.freeAbovePx - COMPOSER_TOP_CLEARANCE_PX);
  if (room >= COMPOSER_EDITOR_MAX_HEIGHT_PX) return null;
  return Math.max(COMPOSER_EDITOR_MIN_HEIGHT_PX, room);
}

/**
 * Keeps COMPOSER_EDITOR_MAX_HEIGHT_VAR on the composer form in step with the column's
 * height and the composer's own (context bar, banners, attachments), writing the style
 * directly so typing never re-renders the chat view.
 */
export function useComposerEditorRoom(input: {
  enabled: boolean;
  boundsRef: RefObject<HTMLElement | null>;
  formRef: RefObject<HTMLFormElement | null>;
}): void {
  const { enabled, boundsRef, formRef } = input;
  useLayoutEffect(() => {
    const bounds = boundsRef.current;
    const form = formRef.current;
    if (!enabled || !bounds || !form) return;
    let applied: number | null = null;
    const sync = () => {
      const editor = form.querySelector<HTMLElement>('[data-testid="composer-editor"]');
      if (!editor) return;
      const boundsTop = bounds.getBoundingClientRect().top;
      const formTop = form.getBoundingClientRect().top;
      const editorHeight = editor.getBoundingClientRect().height;
      // Hidden panes measure zero; keep the last cap until they show again.
      if (editorHeight <= 0) return;
      const next = composerEditorMaxHeightPx({
        editorHeightPx: editorHeight,
        freeAbovePx: formTop - boundsTop,
      });
      if (next === applied) return;
      applied = next;
      if (next === null) form.style.removeProperty(COMPOSER_EDITOR_MAX_HEIGHT_VAR);
      else form.style.setProperty(COMPOSER_EDITOR_MAX_HEIGHT_VAR, `${next}px`);
    };
    sync();
    if (typeof ResizeObserver === "undefined") {
      return () => form.style.removeProperty(COMPOSER_EDITOR_MAX_HEIGHT_VAR);
    }
    // The editor's height plus the room above the composer stays constant while typing, so
    // the cap changes only when the column or the composer's chrome resizes. Apply it on the
    // next frame then: resizing the composer inside this callback would resize the overlay
    // that useComposerOverlayHeight observes, an ancestor, and raise a ResizeObserver loop.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    });
    observer.observe(bounds);
    observer.observe(form);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      form.style.removeProperty(COMPOSER_EDITOR_MAX_HEIGHT_VAR);
    };
  }, [enabled, boundsRef, formRef]);
}

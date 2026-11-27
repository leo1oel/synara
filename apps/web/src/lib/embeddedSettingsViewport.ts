/**
 * The part of the embedded Settings frame that Lattice shows.
 *
 * Lattice sizes the Settings frame to the whole page and scrolls it inside a
 * shorter sheet, so nothing inside the frame can see where the sheet's edges
 * are. Lattice posts them instead, on every scroll, resize and height change:
 * `{ type: "lattice:settings-viewport", top, height }`, in CSS px of this
 * document, where `top` is how far the visible part starts below the frame's
 * top. The first such message makes it authoritative for the rest of the page's
 * life. Listening starts when this module loads, so a message posted before any
 * popup opens is kept.
 */

export interface VisibleRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const SETTINGS_VIEWPORT_MESSAGE = "lattice:settings-viewport";

let hostVisibleRect: VisibleRect | undefined;
const listeners = new Set<() => void>();

function readHostViewport(data: unknown): { top: number; height: number } | null {
  if (typeof data !== "object" || data === null) return null;
  const { type, top, height } = data as Record<string, unknown>;
  if (type !== SETTINGS_VIEWPORT_MESSAGE) return null;
  if (typeof top !== "number" || !Number.isFinite(top) || top < 0) return null;
  if (typeof height !== "number" || !Number.isFinite(height) || height < 0) return null;
  return { top, height };
}

if (typeof window !== "undefined" && window.parent !== window) {
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const viewport = readHostViewport(event.data);
    if (!viewport) return;
    hostVisibleRect = {
      x: 0,
      y: viewport.top,
      width: document.documentElement.clientWidth,
      height: viewport.height,
    };
    for (const listener of listeners) listener();
  });
}

export function subscribeHostVisibleRect(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The visible part Lattice last posted, or `undefined` before its first message. */
export function getHostVisibleRect(): VisibleRect | undefined {
  return hostVisibleRect;
}

import { useEffect } from "react";
import {
  postPopupOpenToLattice,
  readEmbedMode,
  readLatticeOutsidePointerDownMessage,
} from "./embedMode";

/**
 * Lattice embeds this app in a cross-origin iframe, and a press anywhere else
 * in its window never reaches this document, so a Base UI menu, select or
 * popover (which dismisses on a press it hears here) stayed open until an item
 * was chosen. Lattice reports such a press (`lattice:outside-pointerdown`), and
 * this frame replays it as a press on its own root element: every primitive
 * already treats that as a press outside its popup and closes through its
 * usual path, so no call site changes. Losing window focus does the same.
 *
 * Lattice needs to know whether a popup is open: like Base UI's modal backdrop
 * in this frame, it lets that press only close the popup. It hears `open: true`
 * when a popup opens and `open: false` once none is; it clears its own flag
 * when it reports a press, so each `open: true` is good for one press, and a
 * popup that ignores outside presses costs at most that one.
 */

/** Open popups; a popup that closes without an outside press supplies `dismiss`. */
const openPopups = new Set<{ dismiss: (() => void) | undefined }>();
let reportedOpen = false;

function reportOpenState() {
  const open = openPopups.size > 0;
  if (open === reportedOpen) return;
  const config = readEmbedMode();
  if (!config?.hostOrigin || window.parent === window) return;
  reportedOpen = open;
  postPopupOpenToLattice(config, open);
}

/**
 * Count a popup as open until the returned release runs. `dismiss` closes a
 * popup the replayed root press does not reach (one with its own overlay).
 */
export function trackOpenPopup(dismiss?: () => void): () => void {
  const entry = { dismiss };
  openPopups.add(entry);
  reportOpenState();
  return () => {
    if (!openPopups.delete(entry)) return;
    reportOpenState();
  };
}

/** Track a popup component for as long as it is mounted (its exit animation included). */
export function useTrackedOpenPopup(): void {
  useEffect(() => trackOpenPopup(), []);
}

/**
 * React callback ref for a Base UI positioner: track the popup while it has
 * `data-open`. Mounting is no guide, since a Select keeps its popup mounted
 * once its trigger has been focused, and a closing popup stays mounted
 * through its exit animation.
 */
export function observeHostDismissiblePopup(element: HTMLElement | null): (() => void) | undefined {
  if (!element) return;
  let release: (() => void) | null = null;
  const sync = () => {
    const open = element.hasAttribute("data-open");
    if (open && !release) release = trackOpenPopup();
    if (!open && release) {
      release();
      release = null;
    }
  };
  const observer = new MutationObserver(sync);
  observer.observe(element, { attributes: true, attributeFilter: ["data-open"] });
  sync();
  return () => {
    observer.disconnect();
    release?.();
  };
}

async function replayPress(target: Element) {
  const view = target.ownerDocument.defaultView;
  const down = { bubbles: true, cancelable: true, composed: true, view, button: 0, buttons: 1 };
  const up = { ...down, buttons: 0 };
  const pointer = { pointerId: 1, pointerType: "mouse", isPrimary: true };
  // Base UI's outside press is `pointerdown` ("sloppy") or a `click` that
  // also began outside ("intentional"), so the whole press is replayed. A
  // real press runs microtasks between its events, which is when React
  // commits a popup's close and drops its listeners; without that, each later
  // event would close it again.
  for (const event of [
    new PointerEvent("pointerdown", { ...down, ...pointer }),
    new MouseEvent("mousedown", down),
    new PointerEvent("pointerup", { ...up, ...pointer }),
    new MouseEvent("mouseup", up),
    new MouseEvent("click", up),
  ]) {
    target.dispatchEvent(event);
    await Promise.resolve();
  }
}

/** Close every open popup as a press outside all of them would. */
export async function dismissOpenPopups(): Promise<void> {
  if (openPopups.size === 0) return;
  const dismissals = [...openPopups].flatMap((entry) => entry.dismiss ?? []);
  await replayPress(document.documentElement);
  for (const dismiss of dismissals) dismiss();
}

export function startLatticePopupDismissal(): () => void {
  const config = readEmbedMode();
  if (!config?.hostOrigin || window.parent === window) return () => undefined;
  const onMessage = (event: MessageEvent) => {
    if (!readLatticeOutsidePointerDownMessage(event, config)) return;
    // Lattice cleared its flag when it sent this, so the next popup to open
    // is reported again even if one of these is still closing.
    reportedOpen = false;
    void dismissOpenPopups();
  };
  const onBlur = () => void dismissOpenPopups();
  window.addEventListener("message", onMessage);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("message", onMessage);
    window.removeEventListener("blur", onBlur);
  };
}

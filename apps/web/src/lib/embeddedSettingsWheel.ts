/**
 * Wheel routing for the embedded Settings page.
 *
 * Embedded in Lattice, the Settings document has no scrolling of its own: the
 * frame is as tall as the page and Lattice scrolls its viewport around it, so
 * the page forwards wheel input to Lattice and cancels it here. A wheel over
 * something inside the page that scrolls by itself (a select's option list, a
 * textarea, a code block) must stay with that element instead: cancelling it
 * left a long model picker that the wheel and trackpad could not move.
 */

type Axis = "x" | "y";

function scrollsOnAxis(style: CSSStyleDeclaration, axis: Axis): boolean {
  const overflow = axis === "y" ? style.overflowY : style.overflowX;
  return overflow === "auto" || overflow === "scroll" || overflow === "overlay";
}

function overflowsOnAxis(element: Element, axis: Axis): boolean {
  return axis === "y"
    ? element.scrollHeight > element.clientHeight + 1
    : element.scrollWidth > element.clientWidth + 1;
}

function hasRoomToScroll(element: Element, axis: Axis, delta: number): boolean {
  const position = axis === "y" ? element.scrollTop : element.scrollLeft;
  const size = axis === "y" ? element.clientHeight : element.clientWidth;
  const extent = axis === "y" ? element.scrollHeight : element.scrollWidth;
  return delta < 0 ? position > 0 : position + size < extent - 1;
}

/**
 * Whether an element between the wheel's target and the document scrolls with
 * this wheel on either axis it moves, or is an overflowing scroller that keeps
 * its overscroll to itself (`overscroll-behavior: contain`, as every select
 * list does). The browser then handles the wheel natively and Lattice must not
 * scroll as well. Both axes count, since a trackpad's first event of a vertical
 * gesture can carry more sideways noise than vertical movement.
 */
export function wheelBelongsToInnerScroller(
  event: Pick<WheelEvent, "deltaX" | "deltaY" | "target">,
): boolean {
  const moves: Array<[Axis, number]> = [
    ["y", event.deltaY],
    ["x", event.deltaX],
  ];
  let element = event.target instanceof Element ? event.target : null;
  while (element && element !== document.scrollingElement && element !== document.body) {
    const style = getComputedStyle(element);
    for (const [axis, delta] of moves) {
      if (delta === 0 || !scrollsOnAxis(style, axis) || !overflowsOnAxis(element, axis)) continue;
      if (hasRoomToScroll(element, axis, delta)) return true;
      const overscroll = axis === "y" ? style.overscrollBehaviorY : style.overscrollBehaviorX;
      if (overscroll === "contain" || overscroll === "none") return true;
    }
    element = element.parentElement;
  }
  return false;
}

/**
 * A wheel gesture ends after this long without a wheel event. Trackpad and
 * momentum gestures send events every frame, so a gap this long is a new one.
 */
export const WHEEL_GESTURE_GAP_MS = 100;

/**
 * Hands every wheel the page does not scroll itself to `forward` and cancels
 * it here, so the frame never scrolls on its own. Returns the cleanup.
 *
 * The choice is made once per gesture, at its first event, the way a browser
 * latches a scroll gesture to one scroller: a gesture that starts on the page
 * keeps scrolling the page when an open list slides under the pointer, and one
 * that starts on a list stays with it when the pointer leaves the list.
 */
export function listenForEmbeddedSettingsWheel(forward: (event: WheelEvent) => void): () => void {
  let gesture: { inner: boolean; lastAt: number } | null = null;
  const onWheel = (event: WheelEvent) => {
    const current =
      gesture && event.timeStamp - gesture.lastAt <= WHEEL_GESTURE_GAP_MS ? gesture : null;
    // An event that moves nothing says nothing about where the gesture goes,
    // so it neither starts nor extends one.
    if (event.deltaX === 0 && event.deltaY === 0) {
      if (current?.inner) return;
      forward(event);
      event.preventDefault();
      return;
    }
    gesture = current ?? { inner: wheelBelongsToInnerScroller(event), lastAt: event.timeStamp };
    gesture.lastAt = event.timeStamp;
    if (gesture.inner) return;
    forward(event);
    event.preventDefault();
  };
  window.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => window.removeEventListener("wheel", onWheel, { capture: true });
}

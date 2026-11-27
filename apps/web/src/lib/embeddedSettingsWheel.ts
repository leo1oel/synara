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
 * this wheel, or is an overflowing scroller that keeps its overscroll to itself
 * (`overscroll-behavior: contain`, as every select list does). The browser
 * then handles the wheel natively and Lattice must not scroll as well.
 */
export function wheelBelongsToInnerScroller(
  event: Pick<WheelEvent, "deltaX" | "deltaY" | "target">,
): boolean {
  const axis: Axis = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? "x" : "y";
  const delta = axis === "y" ? event.deltaY : event.deltaX;
  if (delta === 0) return false;
  let element = event.target instanceof Element ? event.target : null;
  while (element && element !== document.scrollingElement && element !== document.body) {
    const style = getComputedStyle(element);
    if (scrollsOnAxis(style, axis) && overflowsOnAxis(element, axis)) {
      if (hasRoomToScroll(element, axis, delta)) return true;
      const overscroll = axis === "y" ? style.overscrollBehaviorY : style.overscrollBehaviorX;
      if (overscroll === "contain" || overscroll === "none") return true;
    }
    element = element.parentElement;
  }
  return false;
}

/**
 * Hands every wheel the page does not scroll itself to `forward` and cancels
 * it here, so the frame never scrolls on its own. Returns the cleanup.
 */
export function listenForEmbeddedSettingsWheel(forward: (event: WheelEvent) => void): () => void {
  const onWheel = (event: WheelEvent) => {
    if (wheelBelongsToInnerScroller(event)) return;
    forward(event);
    event.preventDefault();
  };
  window.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => window.removeEventListener("wheel", onWheel, { capture: true });
}

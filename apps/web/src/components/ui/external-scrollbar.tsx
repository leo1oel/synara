// FILE: external-scrollbar.tsx
// Purpose: Overlay scrollbar for scroll owners that cannot be wrapped by ScrollArea
//          (e.g. LegendList's virtualized viewport, which owns follow-to-bottom).
// Layer: UI component
// Exports: ExternalScrollbar
//
// Native scrollbars are unusable for these surfaces in the embedded panel:
// WebKit repaints `::-webkit-scrollbar-*` hover state lazily, and when the
// pointer exits the host iframe straight across the bar the thumb sticks at
// its hovered width indefinitely. A real DOM overlay driven by React state
// fades exactly like ScrollArea's `.synara-scrollbar` does.

import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { readEmbedMode, readLatticeHostPointerMessage } from "../../embedMode";
import {
  calculateVerticalScrollGeometry,
  EXTERNAL_SCROLLBAR_TRACK_INSET,
  type VerticalScrollGeometry,
} from "./external-scrollbar-geometry";

type ExternalScrollbarProps = {
  /**
   * Finds the scroll owner. It must live under this overlay's parent element:
   * the overlay re-runs it when that subtree changes, never on a timer.
   */
  getViewport: () => HTMLElement | null;
  /** Keep the track above a floating surface without resizing its scroll owner. */
  bottomInsetPx?: number;
};

const SCROLLING_HIDE_DELAY_MS = 500;

const EMPTY_GEOMETRY: VerticalScrollGeometry = {
  height: 0,
  maxScrollTop: 0,
  overflow: false,
  scrollTop: 0,
  thumbHeight: 0,
  thumbOffset: 0,
  top: 0,
};

export function ExternalScrollbar({ getViewport, bottomInsetPx = 0 }: ExternalScrollbarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const scrollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    scrollPerPixel: number;
    startClientY: number;
    startScrollTop: number;
  } | null>(null);
  const [geometry, setGeometry] = useState(EMPTY_GEOMETRY);
  const [hovering, setHovering] = useState(false);
  const [scrolling, setScrolling] = useState(false);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    const surface = track?.parentElement;
    if (!viewport || !surface) {
      setGeometry(EMPTY_GEOMETRY);
      return;
    }
    const viewportRect = viewport.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    setGeometry(
      calculateVerticalScrollGeometry(viewport, viewportRect.top - surfaceRect.top, bottomInsetPx),
    );
  }, [bottomInsetPx]);

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    let resizeObserver: ResizeObserver | null = null;
    let viewport: HTMLElement | null = null;
    const surface = trackRef.current?.parentElement ?? null;

    const markScrolling = () => {
      scheduleMeasure();
      setScrolling(true);
      if (scrollingTimerRef.current != null) clearTimeout(scrollingTimerRef.current);
      scrollingTimerRef.current = setTimeout(() => {
        scrollingTimerRef.current = null;
        setScrolling(false);
      }, SCROLLING_HIDE_DELAY_MS);
    };

    const detach = () => {
      viewport?.removeEventListener("scroll", markScrolling);
      resizeObserver?.disconnect();
      resizeObserver = null;
      viewport = null;
      viewportRef.current = null;
    };

    const attach = (next: HTMLElement) => {
      viewport = next;
      viewportRef.current = next;
      next.addEventListener("scroll", markScrolling, { passive: true });
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(scheduleMeasure);
        resizeObserver.observe(next);
        // Streamed rows grow the content without resizing the viewport, so the
        // thumb proportion must track the inner container too.
        const content = next.firstElementChild;
        if (content instanceof HTMLElement) resizeObserver.observe(content);
        if (surface) resizeObserver.observe(surface);
      }
    };

    // The scroll owner can be absent for the whole life of this overlay: an
    // empty thread (new chat, no messages, signed out) renders the timeline's
    // empty state instead of LegendList, and the virtualized list may also
    // mount after this overlay. It can be replaced too, when a thread empties
    // and refills. Polling for it every frame kept the hidden Agent iframe
    // busy for the whole app lifetime (WebKit does not throttle rAF there), so
    // react to DOM changes under the shared surface instead. While attached
    // the callback only re-queries when the owner left the DOM or lost the
    // attribute that marks it (React can reuse the element for another state).
    const sync = (records?: MutationRecord[]) => {
      if (
        viewport?.isConnected &&
        !records?.some((record) => record.type === "attributes" && record.target === viewport)
      ) {
        return;
      }
      const next = getViewport();
      if (next === viewport) return;
      if (viewport) detach();
      if (next) attach(next);
      scheduleMeasure();
    };

    let mutationObserver: MutationObserver | null = null;
    if (surface && typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(sync);
      mutationObserver.observe(surface, {
        attributeFilter: ["data-chat-scroll-container"],
        childList: true,
        subtree: true,
      });
    }
    sync();

    return () => {
      mutationObserver?.disconnect();
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (scrollingTimerRef.current != null) {
        clearTimeout(scrollingTimerRef.current);
        scrollingTimerRef.current = null;
      }
      detach();
    };
  }, [getViewport, scheduleMeasure]);

  // WebKit never delivers pointerleave when the cursor crosses straight out of
  // the embed iframe — and this track sits on that very edge — so hover state
  // would stick until the pointer came back. The host posts a message whenever
  // its own document sees the pointer; treat that as the missing leave.
  useEffect(() => {
    const config = readEmbedMode();
    if (!config?.hostOrigin) return;
    const clearHover = () => {
      setHovering(false);
      if (!dragRef.current) setScrolling(false);
    };
    const onHostMessage = (event: MessageEvent) => {
      if (readLatticeHostPointerMessage(event, config)) clearHover();
    };
    window.addEventListener("message", onHostMessage);
    window.addEventListener("blur", clearHover);
    return () => {
      window.removeEventListener("message", onHostMessage);
      window.removeEventListener("blur", clearHover);
    };
  }, []);

  const scrollToThumbOffset = (thumbOffset: number) => {
    const viewport = viewportRef.current;
    const availableTrack = Math.max(0, geometry.height - EXTERNAL_SCROLLBAR_TRACK_INSET * 2);
    const travel = Math.max(0, availableTrack - geometry.thumbHeight);
    if (!viewport || travel <= 0) return;
    viewport.scrollTop =
      geometry.maxScrollTop * (Math.min(Math.max(0, thumbOffset), travel) / travel);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || !geometry.overflow) return;
    event.preventDefault();
    const track = event.currentTarget;
    const isThumb =
      event.target instanceof HTMLElement && event.target.dataset.slot === "scroll-area-thumb";
    const availableTrack = Math.max(0, geometry.height - EXTERNAL_SCROLLBAR_TRACK_INSET * 2);
    const travel = Math.max(0, availableTrack - geometry.thumbHeight);
    if (!isThumb) {
      const rect = track.getBoundingClientRect();
      scrollToThumbOffset(
        event.clientY - rect.top - EXTERNAL_SCROLLBAR_TRACK_INSET - geometry.thumbHeight / 2,
      );
    }
    dragRef.current = {
      pointerId: event.pointerId,
      scrollPerPixel: travel > 0 ? geometry.maxScrollTop / travel : 0,
      startClientY: event.clientY,
      startScrollTop: viewport.scrollTop,
    };
    track.setPointerCapture(event.pointerId);
    setScrolling(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const drag = dragRef.current;
    if (!viewport || !drag || drag.pointerId !== event.pointerId) return;
    viewport.scrollTop =
      drag.startScrollTop + (event.clientY - drag.startClientY) * drag.scrollPerPixel;
  };

  const endPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setScrolling(false);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || !geometry.overflow) return;
    event.preventDefault();
    viewport.scrollTop += event.deltaY;
  };

  return (
    <div
      ref={trackRef}
      aria-hidden="true"
      className="synara-scrollbar external-scrollbar"
      data-hovering={hovering ? "" : undefined}
      data-orientation="vertical"
      data-overflow-y-end={
        geometry.overflow && geometry.scrollTop < geometry.maxScrollTop ? "" : undefined
      }
      data-overflow-y-start={geometry.overflow && geometry.scrollTop > 0 ? "" : undefined}
      data-scrolling={scrolling ? "" : undefined}
      onPointerCancel={endPointerDrag}
      onPointerDown={handlePointerDown}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => {
        setHovering(false);
        if (!dragRef.current) setScrolling(false);
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointerDrag}
      onWheel={handleWheel}
      style={{
        height: geometry.height,
        top: geometry.top,
      }}
    >
      <div
        className="synara-scrollbar-thumb"
        data-slot="scroll-area-thumb"
        style={{
          height: geometry.thumbHeight,
          transform: `translate3d(-2px, ${geometry.thumbOffset}px, 0)`,
        }}
      />
    </div>
  );
}

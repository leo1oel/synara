"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";

import { fluidSpring } from "~/lib/motionTokens";
import { cn } from "~/lib/utils";
import "./fluid-hover.css";

type FluidHoverRect = { height: number; left: number; top: number; width: number };

const disabledSelector =
  ':disabled, [data-disabled]:not([data-disabled="false"]), [aria-disabled="true"], [data-variant="destructive"]';

/**
 * Adds one visual hover fill to an existing vertical collection without wrapping
 * or replacing its rows. The owning primitive keeps pointer, keyboard, focus,
 * selection, disabled, and click behavior; whitespace remains inert.
 */
export function FluidHoverSurface({
  asListItem = false,
  className,
  selector,
}: {
  asListItem?: boolean;
  className?: string;
  selector: string;
}) {
  const markerRef = React.useRef<HTMLElement | null>(null);
  const [rect, setRect] = React.useState<FluidHoverRect | null>(null);
  const [session, setSession] = React.useState(0);
  const reduceMotion = useReducedMotion() ?? false;

  React.useLayoutEffect(() => {
    const marker = markerRef.current;
    const container = marker?.parentElement;
    if (!container) return;
    container.setAttribute("data-fluid-hover-scope", "");

    let activeItem: HTMLElement | null = null;
    const clear = () => {
      activeItem?.removeAttribute("data-fluid-hover-active");
      activeItem = null;
      setRect(null);
    };
    const owns = (item: Element) => item.closest("[data-fluid-hover-scope]") === container;
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const target = event.target instanceof Element ? event.target : null;
      const item = target?.closest<HTMLElement>(selector);
      if (event.buttons || !item || !owns(item) || item.matches(disabledSelector)) {
        clear();
        return;
      }
      if (activeItem !== item) {
        activeItem?.removeAttribute("data-fluid-hover-active");
        activeItem = item;
        item.setAttribute("data-fluid-hover-active", "");
      }
      const containerRect = container.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      // Popup entrance scales the whole coordinate space. Store layout-space
      // geometry so the fill isn't scaled twice while the popup settles.
      const scaleX = container.offsetWidth ? containerRect.width / container.offsetWidth : 1;
      const scaleY = container.offsetHeight ? containerRect.height / container.offsetHeight : 1;
      setRect({
        height: itemRect.height / scaleY,
        left:
          (itemRect.left - containerRect.left) / scaleX +
          container.scrollLeft -
          container.clientLeft,
        top:
          (itemRect.top - containerRect.top) / scaleY + container.scrollTop - container.clientTop,
        width: itemRect.width / scaleX,
      });
    };
    const enter = () => setSession((value) => value + 1);
    const observer = new MutationObserver((records) => {
      const collectionChanged = records.some((record) =>
        [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            !(node instanceof Element) ||
            node.getAttribute("data-slot") !== "fluid-hover-highlight",
        ),
      );
      if (collectionChanged) clear();
    });
    observer.observe(container, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(clear);
    resizeObserver.observe(container);
    container.addEventListener("pointerenter", enter);
    container.addEventListener("pointermove", move);
    container.addEventListener("pointerleave", clear);
    container.addEventListener("pointerdown", clear);
    container.addEventListener("scroll", clear, true);
    container.ownerDocument.addEventListener("keydown", clear, true);
    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      activeItem?.removeAttribute("data-fluid-hover-active");
      container.removeAttribute("data-fluid-hover-scope");
      container.removeEventListener("pointerenter", enter);
      container.removeEventListener("pointermove", move);
      container.removeEventListener("pointerleave", clear);
      container.removeEventListener("pointerdown", clear);
      container.removeEventListener("scroll", clear, true);
      container.ownerDocument.removeEventListener("keydown", clear, true);
    };
  }, [selector]);

  const Marker = asListItem ? "li" : "span";
  const Highlight = asListItem ? motion.li : motion.span;
  return (
    <>
      <Marker
        aria-hidden="true"
        className="hidden"
        ref={(node) => {
          markerRef.current = node;
        }}
        role={asListItem ? "presentation" : undefined}
      />
      <AnimatePresence>
        {rect ? (
          <Highlight
            key={session}
            aria-hidden="true"
            className={cn("fluid-hover-highlight", className)}
            data-slot="fluid-hover-highlight"
            initial={{
              opacity: 0,
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
            }}
            animate={{
              opacity: 1,
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
            }}
            exit={{ opacity: 0 }}
            transition={
              reduceMotion
                ? { duration: 0, opacity: { duration: 0.08 } }
                : { ...fluidSpring.fast, opacity: { duration: 0.08 } }
            }
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}

"use client";

// FILE: switch.tsx
// Purpose: Shared accent-colored on/off switch primitive used by settings, menus, and dialogs.
// Layer: Base UI component
// Exports: Switch plus track/thumb class names for compact switch-shaped controls

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { motion, useReducedMotion, type MotionStyle, type Variants } from "motion/react";
import type { HTMLAttributes } from "react";

import { fluidSpring } from "~/lib/motionTokens";
import { cn } from "~/lib/utils";

const SWITCH_TRACK_CLASS_NAME =
  "inline-flex h-[calc(var(--thumb-size)+4px)] w-[calc(var(--thumb-size)*2)] shrink-0 cursor-pointer items-center rounded-full border p-px outline-none transition-[background-color,box-shadow,border-color] duration-200 [--switch-thumb-travel:calc(var(--thumb-size)-4px)] [--thumb-size:--spacing(5)] focus-visible:ring-2 focus-visible:ring-[color:var(--color-border-focus)]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:border-[color:var(--color-text-accent)] data-checked:bg-[var(--color-text-accent)] data-unchecked:border-[color:color-mix(in_srgb,var(--color-text-foreground)_14%,transparent)] data-unchecked:bg-[color-mix(in_srgb,var(--color-text-foreground)_20%,var(--color-background-control-opaque))] data-disabled:cursor-not-allowed data-disabled:opacity-64 sm:[--thumb-size:--spacing(4)]";

const SWITCH_THUMB_CLASS_NAME =
  "pointer-events-none block aspect-square h-full rounded-full bg-[#F9F9FA] shadow-sm ring-1 ring-black/5 will-change-transform [transition:translate_.2s_ease-out,border-radius_.15s,scale_.1s_.1s,transform-origin_.15s]";

// Base UI supplies DOM event props; Motion uses these four names for its own
// animation/drag callbacks. This switch has no drag gesture or CSS animation.
function motionDomProps<T extends HTMLAttributes<HTMLElement>>(props: T) {
  const {
    onDrag: _onDrag,
    onDragStart: _onDragStart,
    onDragEnd: _onDragEnd,
    onAnimationStart: _onAnimationStart,
    style,
    ...rest
  } = props;
  return { ...rest, style: (style ?? {}) as MotionStyle };
}

const switchThumbVariants: Variants = {
  unchecked: { x: 0, scaleX: 1, scaleY: 1, transformOrigin: "left center" },
  checked: {
    x: "var(--switch-thumb-travel)",
    scaleX: 1,
    scaleY: 1,
    transformOrigin: "right center",
  },
  uncheckedHover: { x: 0, scaleX: 1.2, scaleY: 1, transformOrigin: "left center" },
  checkedHover: {
    x: "var(--switch-thumb-travel)",
    scaleX: 1.2,
    scaleY: 1,
    transformOrigin: "right center",
  },
  uncheckedPress: { x: 0, scaleX: 1.4, scaleY: 0.8, transformOrigin: "left center" },
  checkedPress: {
    x: "var(--switch-thumb-travel)",
    scaleX: 1.4,
    scaleY: 0.8,
    transformOrigin: "right center",
  },
};

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  const reduceMotion = useReducedMotion();

  return (
    <SwitchPrimitive.Root
      className={(state) =>
        cn(
          SWITCH_TRACK_CLASS_NAME,
          typeof className === "function" ? className(state) : className,
        )
      }
      data-slot="switch"
      {...props}
      nativeButton
      render={(rootProps, state) => {
        const resting = state.checked ? "checked" : "unchecked";
        const hover = state.checked ? "checkedHover" : "uncheckedHover";
        const press = state.checked ? "checkedPress" : "uncheckedPress";

        return (
          <motion.button
            {...motionDomProps(rootProps)}
            animate={resting}
            initial={false}
            whileHover={state.disabled || reduceMotion ? resting : hover}
            whileTap={state.disabled || reduceMotion ? resting : press}
          >
            <SwitchPrimitive.Thumb
              className={SWITCH_THUMB_CLASS_NAME}
              data-slot="switch-thumb"
              render={(thumbProps) => (
                <motion.span
                  {...motionDomProps(thumbProps)}
                  variants={switchThumbVariants}
                  transition={reduceMotion ? { duration: 0 } : fluidSpring.moderate}
                />
              )}
            />
          </motion.button>
        );
      }}
    />
  );
}

export { Switch, SWITCH_THUMB_CLASS_NAME, SWITCH_TRACK_CLASS_NAME };

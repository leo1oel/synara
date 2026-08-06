"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { mergeProps } from "@base-ui/react/merge-props";
import type * as React from "react";

import { cn } from "~/lib/utils";
import { FIELD_CONTROL_CLASS_NAME, FIELD_MULTILINE_CONTENT_CLASS_NAME } from "./field-styles";

type TextareaProps = React.ComponentProps<"textarea"> & {
  size?: "sm" | "default" | "lg" | number;
  unstyled?: boolean;
};

function Textarea({ className, size: sizeProp, unstyled: unstyledProp, ...props }: TextareaProps) {
  const size = sizeProp ?? "default";
  const unstyled = unstyledProp ?? false;
  return (
    <span
      className={
        cn(
          !unstyled &&
            cn(
              "relative inline-flex w-full rounded-lg text-[length:var(--app-font-size-ui,12px)] text-foreground has-aria-invalid:border-destructive/36 has-focus-visible:has-aria-invalid:border-destructive/64 has-disabled:opacity-64 sm:text-[length:var(--app-font-size-ui,12px)]",
              FIELD_CONTROL_CLASS_NAME,
            ),
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="textarea-control"
    >
      <FieldPrimitive.Control
        render={(defaultProps) => (
          <textarea
            className={cn(
              "font-system-ui field-sizing-content min-h-17.5 w-full resize-none rounded-[inherit] px-[calc(--spacing(3)-1px)] py-[calc(--spacing(1.5)-1px)] outline-none max-sm:min-h-20.5",
              FIELD_MULTILINE_CONTENT_CLASS_NAME,
              size === "sm" &&
                "min-h-16.5 px-[calc(--spacing(2.5)-1px)] py-[calc(--spacing(1)-1px)] max-sm:min-h-19.5",
              size === "lg" && "min-h-18.5 py-[calc(--spacing(2)-1px)] max-sm:min-h-21.5",
            )}
            data-slot="textarea"
            {...mergeProps(defaultProps, props)}
          />
        )}
      />
    </span>
  );
}

export { Textarea, type TextareaProps };

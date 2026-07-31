// FILE: field-styles.ts
// Purpose: One visual and overflow contract for every text-entry control.
// Layer: UI styling

export const FIELD_CONTROL_CLASS_NAME =
  "border border-border bg-foreground/2 shadow-none transition-colors hover:border-foreground/25 has-focus-visible:border-foreground/25 has-focus-visible:ring-0 focus-visible:border-foreground/25 focus-visible:ring-0";

/** Exact single-line heights shared by inputs, search fields, input groups, and selects. */
export const FIELD_CONTROL_HEIGHT_CLASS_NAME = "h-8 min-h-8";
export const FIELD_CONTROL_COMPACT_HEIGHT_CLASS_NAME = "h-7 min-h-7";
export const FIELD_CONTROL_LARGE_HEIGHT_CLASS_NAME = "h-[38px] min-h-[38px]";

export const FIELD_SINGLE_LINE_CONTENT_CLASS_NAME =
  "min-w-0 max-w-full overflow-x-hidden text-ellipsis whitespace-nowrap";

export const FIELD_MULTILINE_CONTENT_CLASS_NAME =
  "min-w-0 max-w-full overflow-x-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere]";

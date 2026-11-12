import { t } from "~/i18n";

import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { CircleAlertIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

/** Accessible label on the warning glyph. */
export const DRAFT_ATTACHMENT_WARNING_LABEL = "lattice:draftAttachmentMayNotPersist";
/** Explanatory copy shown in the hover tooltip / detail row (render with `i18n._`). */
export const DRAFT_ATTACHMENT_WARNING_DESCRIPTION = "lattice:draftAttachmentIsKeptInMemoryAnd";

// `inline` sits in a card's detail row; `badge` floats over an image thumbnail
// (opaque surface + shadow so it stays legible on any preview).
export type DraftAttachmentWarningVariant = "inline" | "badge";

type DraftAttachmentWarningIconProps = ComponentPropsWithoutRef<"span"> & {
  variant?: DraftAttachmentWarningVariant;
};

// forwardRef + prop spread so the badge can act as a Base UI tooltip trigger.
export const DraftAttachmentWarningIcon = forwardRef<
  HTMLSpanElement,
  DraftAttachmentWarningIconProps
>(function DraftAttachmentWarningIcon({ variant: variantProp, className, ...rest }, ref) {
  const variant = variantProp ?? "inline";
  return (
    <span
      ref={ref}
      {...rest}
      role="img"
      aria-label={t(DRAFT_ATTACHMENT_WARNING_LABEL)}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-amber-600",
        variant === "badge" ? "size-5 bg-[var(--composer-surface)] shadow-sm" : "size-4",
        className,
      )}
    >
      <CircleAlertIcon className="size-3" />
    </span>
  );
});

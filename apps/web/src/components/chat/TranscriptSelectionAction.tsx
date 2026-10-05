// FILE: TranscriptSelectionAction.tsx
// Purpose: Renders the floating toolbar for assistant transcript selections.
// Layer: Chat transcript interaction UI

import { cn } from "~/lib/utils";
import { ELEVATED_HOVER_SURFACE_CLASS_NAME } from "~/surfaceStyles";

interface TranscriptSelectionActionProps {
  left: number;
  top: number;
  placement: "top" | "bottom";
  onAddToChat: () => void;
  onAddToSide?: (() => void) | undefined;
  onAddToNewChat?: (() => void) | undefined;
  sideDisabled?: boolean;
  disabled?: boolean | undefined;
}

function TranscriptSelectionToolbarButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "pointer-events-auto inline-flex h-6 items-center gap-1 rounded px-1.5 text-ui-xs leading-none font-medium text-[var(--color-text-foreground)]",
        ELEVATED_HOVER_SURFACE_CLASS_NAME,
      )}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      <span>{label}</span>
    </button>
  );
}

export function TranscriptSelectionAction(props: TranscriptSelectionActionProps) {
  return (
    <div
      data-transcript-selection-action="true"
      className="pointer-events-none fixed z-50"
      style={{ left: props.left, top: props.top }}
      role="toolbar"
      aria-label="Selection actions"
    >
      <div
        className={cn(
          "pointer-events-auto inline-flex items-center gap-px rounded-md border border-[color:var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)] p-px shadow-md backdrop-blur-md",
          props.placement === "top" ? "origin-bottom" : "origin-top",
        )}
      >
        <TranscriptSelectionToolbarButton
          label="Add to Chat"
          onClick={props.onAddToChat}
          disabled={props.disabled}
        />
        {props.onAddToSide ? (
          <TranscriptSelectionToolbarButton
            label="Add to Side"
            onClick={props.onAddToSide}
            disabled={props.disabled || props.sideDisabled}
          />
        ) : null}
        {props.onAddToNewChat ? (
          <TranscriptSelectionToolbarButton
            label="Add to new Chat"
            onClick={props.onAddToNewChat}
            disabled={props.disabled}
          />
        ) : null}
      </div>
    </div>
  );
}

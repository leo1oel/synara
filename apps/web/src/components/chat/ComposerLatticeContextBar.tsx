// FILE: ComposerLatticeContextBar.tsx
// Purpose: Makes Lattice's automatically injected editor/PDF/paper context
// visible and inspectable immediately above the embedded chat composer.
// Layer: Chat composer UI

import { useState, useSyncExternalStore } from "react";

import {
  EyeIcon,
  PanelCollapseIcon,
  PanelExpandIcon,
  XIcon,
} from "~/lib/icons";
import {
  getLiveLatticeHostContext,
  subscribeLiveLatticeHostContext,
} from "~/lib/latticeHostContext";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import {
  latticeContextDetails,
  latticeContextSelection,
  latticeContextSummary,
} from "./ComposerLatticeContextBar.logic";
import {
  ComposerStackedPanelHeaderRow,
  ComposerStackedPanelRowMain,
} from "./ComposerStackedPanelContent";
import {
  COMPOSER_STACKED_PANEL_DIVIDER_CLASS_NAME,
  ComposerStackedPanel,
} from "./ComposerStackedPanel";
import {
  COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_CLASS_NAME,
} from "./composerStackedPanelStyles";

interface ComposerLatticeContextBarProps {
  onClearSelection?: () => void;
  attachedToPrevious?: boolean;
}

export function ComposerLatticeContextBar({
  onClearSelection,
  attachedToPrevious: attachedToPreviousProp,
}: ComposerLatticeContextBarProps) {
  const [expanded, setExpanded] = useState(false);
  const context = useSyncExternalStore(
    subscribeLiveLatticeHostContext,
    getLiveLatticeHostContext,
    getLiveLatticeHostContext,
  );
  if (!context) return null;
  const attachedToPrevious = attachedToPreviousProp ?? false;
  const summary = latticeContextSummary(context);
  const details = latticeContextDetails(context);
  const selection = latticeContextSelection(context);
  const disclosureLabel = expanded
    ? "Hide included context details"
    : "Show included context details";

  return (
    <ComposerStackedPanel
      attachedToPrevious={attachedToPrevious}
      data-testid="composer-lattice-context"
    >
      <ComposerStackedPanelHeaderRow>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-expanded={expanded}
          aria-label={disclosureLabel}
          title={`${summary}. Included with your next message.`}
          onClick={() => setExpanded((current) => !current)}
        >
          <EyeIcon className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME} />
          <span className="shrink-0 text-[12px] font-medium text-foreground/90">
            Context
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/75">
            {summary}
          </span>
          {selection ? (
            <span className="shrink-0 rounded-full bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-foreground-secondary)]">
              {selection.length.toLocaleString()} chars
            </span>
          ) : (
            <span className="shrink-0 text-[10px] text-muted-foreground/55">Included</span>
          )}
          {expanded ? (
            <PanelCollapseIcon className="size-3 shrink-0 text-muted-foreground/65" />
          ) : (
            <PanelExpandIcon className="size-3 shrink-0 text-muted-foreground/65" />
          )}
        </button>
        {selection && onClearSelection ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn("shrink-0", COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME)}
            onClick={onClearSelection}
            aria-label="Exclude selected text from context"
            title="Exclude selected text from the next message"
          >
            <XIcon className="size-3" />
          </Button>
        ) : null}
      </ComposerStackedPanelHeaderRow>

      <DisclosureRegion open={expanded}>
        <div
          className={cn(
            COMPOSER_STACKED_PANEL_DIVIDER_CLASS_NAME,
            COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
            "max-h-56 overflow-y-auto overscroll-contain pt-2",
          )}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground/75">
              Included automatically with your next message
            </p>
            <span className="shrink-0 rounded-full bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-foreground-secondary)]">
              Included
            </span>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]">
            {details.map((detail) => (
              <div key={`${detail.label}:${detail.value}`} className="contents">
                <dt className="text-muted-foreground/60">{detail.label}</dt>
                <dd className="min-w-0 break-words text-foreground/80">{detail.value}</dd>
              </div>
            ))}
          </dl>
          {selection ? (
            <section className="mt-2 border-t border-border/45 pt-2">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-medium text-foreground/85">
                    {selection.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground/55">
                    {selection.length.toLocaleString()} characters
                  </p>
                </div>
                {onClearSelection ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-2 text-[10px] font-normal text-muted-foreground"
                    onClick={onClearSelection}
                  >
                    Exclude selection
                  </Button>
                ) : null}
              </div>
              <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-[var(--color-background-button-secondary)] px-2 py-1.5 font-chat-code text-[10px] leading-relaxed text-foreground/75">
                {selection.text}
              </pre>
            </section>
          ) : null}
        </div>
      </DisclosureRegion>
    </ComposerStackedPanel>
  );
}

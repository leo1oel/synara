import { t, getFormatLocale } from "~/i18n";
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { EyeIcon, PanelCollapseIcon, PanelExpandIcon, XIcon } from "~/lib/icons";
import {
  getLiveLatticeHostContext,
  subscribeLiveLatticeHostContext,
} from "~/lib/latticeHostContext";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { ScrollArea } from "../ui/scroll-area";
import {
  latticeContextDetails,
  latticeContextSelection,
  latticeContextSummary,
} from "./ComposerLatticeContextBar.logic";
import { ComposerStackedPanelHeaderRow } from "./ComposerStackedPanelContent";
import {
  COMPOSER_STACKED_PANEL_DIVIDER_CLASS_NAME,
  ComposerStackedPanel,
} from "./ComposerStackedPanel";
import {
  COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_CLASS_NAME,
} from "./composerStackedPanelStyles";

// "Included" alone also labels bundled skills (内置); the context keeps the two translations apart.
const INCLUDED_WITH_MESSAGE = "lattice:includedWithMessage";

interface ComposerLatticeContextBarProps {
  onClearSelection?: () => void;
  /**
   * The bar's height as it floats above the composer (0 while hidden), for
   * content that must stay clear of it: the composer's measured height
   * leaves it out on purpose.
   */
  onHeightChange?: (heightPx: number) => void;
}

export function ComposerLatticeContextBar({
  onClearSelection,
  onHeightChange,
}: ComposerLatticeContextBarProps) {
  const [expanded, setExpanded] = useState(false);
  const onHeightChangeRef = useRef(onHeightChange);
  useLayoutEffect(() => {
    onHeightChangeRef.current = onHeightChange;
  });
  const observerRef = useRef<ResizeObserver | null>(null);
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    const report = (height: number) => onHeightChangeRef.current?.(Math.ceil(height));
    if (!node) {
      report(0);
      return;
    }
    report(node.getBoundingClientRect().height);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) report(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);
  const context = useSyncExternalStore(
    subscribeLiveLatticeHostContext,
    getLiveLatticeHostContext,
    getLiveLatticeHostContext,
  );
  if (!context) return null;
  const summary = latticeContextSummary(context, t);
  const details = latticeContextDetails(context, t);
  const selection = latticeContextSelection(context, t);
  if (!selection) return null;
  const disclosureLabel = expanded
    ? t("lattice:hideIncludedContextDetails")
    : t("lattice:showIncludedContextDetails");

  return (
    // Keep live editor selections out of the measured composer height: changing
    // the transcript's bottom inset here would move a conversation parked at its end.
    <div className="relative">
      <div ref={measureRef} className="absolute inset-x-0 bottom-0 z-10">
        <ComposerStackedPanel data-testid="composer-lattice-context">
          <ComposerStackedPanelHeaderRow>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              aria-expanded={expanded}
              aria-label={disclosureLabel}
              title={t("lattice:includedWithYourNextMessage", { summary })}
              onClick={() => setExpanded((current) => !current)}
            >
              <EyeIcon className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME} />
              <span className="shrink-0 text-ui font-medium text-foreground/90">
                {t("chat:traitsPicker_context")}
              </span>
              <span className="min-w-0 flex-1 truncate text-ui-sm text-muted-foreground/75">
                {summary}
              </span>
              {selection ? (
                <span className="shrink-0 rounded-full bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 text-ui-xs text-[var(--color-text-foreground-secondary)]">
                  {t("lattice:chars", {
                    count: selection.length.toLocaleString(getFormatLocale()),
                  })}
                </span>
              ) : (
                <span className="shrink-0 text-ui-xs text-muted-foreground/55">
                  {t(INCLUDED_WITH_MESSAGE)}
                </span>
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
                aria-label={t("lattice:excludeSelectedTextFromContext")}
                title={t("lattice:excludeSelectedTextFromTheNextMessage")}
              >
                <XIcon className="size-3" />
              </Button>
            ) : null}
          </ComposerStackedPanelHeaderRow>

          <DisclosureRegion open={expanded}>
            <ScrollArea
              className={cn(COMPOSER_STACKED_PANEL_DIVIDER_CLASS_NAME, "h-auto max-h-56")}
              viewportClassName={cn(
                COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
                "h-auto max-h-56 pt-2",
              )}
              scrollFade
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-ui-sm text-muted-foreground/75">
                  {t("lattice:includedAutomaticallyWithYourNextMessage")}
                </p>
                <span className="shrink-0 rounded-full bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 text-ui-xs font-medium text-[var(--color-text-foreground-secondary)]">
                  {t(INCLUDED_WITH_MESSAGE)}
                </span>
              </div>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-ui-sm">
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
                      <p className="truncate text-ui-sm font-medium text-foreground/85">
                        {selection.label}
                      </p>
                      <p className="text-ui-xs text-muted-foreground/55">
                        {t("chat:characters", {
                          value0: selection.length.toLocaleString(getFormatLocale()),
                        })}
                      </p>
                    </div>
                    {onClearSelection ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 shrink-0 px-2 text-ui-xs font-normal text-muted-foreground"
                        onClick={onClearSelection}
                      >
                        {t("lattice:excludeSelection")}
                      </Button>
                    ) : null}
                  </div>
                  <pre className="whitespace-pre-wrap break-words rounded-md bg-[var(--color-background-button-secondary)] px-2 py-1.5 font-chat-code text-ui-xs leading-relaxed text-foreground/75">
                    {selection.text}
                  </pre>
                </section>
              ) : null}
            </ScrollArea>
          </DisclosureRegion>
        </ComposerStackedPanel>
      </div>
    </div>
  );
}

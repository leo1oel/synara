// FILE: LatticeEmptyThread.tsx
// Purpose: The embedded (Lattice) Agent panel's empty thread: the agent as a
// writing partner, with starters that mirror the editor's selection actions.
// Layer: Chat presentation
// Depends on: Lattice's live host context for the selection chip.

import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FC,
  type SVGProps,
} from "react";
import { flushSync } from "react-dom";

import { i18n } from "~/i18n";
import {
  getLiveLatticeHostContext,
  subscribeLiveLatticeHostContext,
} from "~/lib/latticeHostContext";
import {
  LATTICE_STARTER_KINDS,
  latticeSelectionPlace,
  latticeStarterCopy,
  latticeStarterPrompt,
  type LatticeStarterKind,
} from "./LatticeEmptyThread.logic";
import { COMPOSER_OVERLAY_TUCK_PX } from "./composerOverlay";

type StarterIcon = FC<SVGProps<SVGSVGElement>>;

// Lucide's wand-sparkles, pen-line, spell-check and book-check (ISC), the
// icons Lattice's selection toolbar and proofread card draw for these actions;
// square-dashed-text marks the selection chip.
function lucide(paths: readonly string[]): StarterIcon {
  return function LucideStarterIcon(props) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  };
}

const STARTER_ICONS: Record<LatticeStarterKind, StarterIcon> = {
  polish: lucide([
    "m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72",
    "m14 7 3 3",
    "M5 6v4",
    "M19 14v4",
    "M10 2v2",
    "M7 8H3",
    "M21 16h-4",
    "M11 3H9",
  ]),
  revise: lucide([
    "M13 21h8",
    "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
  ]),
  proofread: lucide(["m6 16 6-12 6 12", "M8 12h8", "m16 20 2 2 4-4"]),
  references: lucide([
    "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20",
    "m9 9.5 2 2 4-4",
  ]),
};

const TextSelectIcon = lucide([
  "M14 21h1",
  "M14 3h1",
  "M19 3a2 2 0 0 1 2 2",
  "M21 14v1",
  "M21 19a2 2 0 0 1-2 2",
  "M21 9v1",
  "M3 14v1",
  "M3 9v1",
  "M5 21a2 2 0 0 1-2-2",
  "M5 3a2 2 0 0 0-2 2",
  "M7 12h10",
  "M7 16h6",
  "M7 8h8",
  "M9 21h1",
  "M9 3h1",
]);

interface LatticeEmptyThreadProps {
  /** The composer floats over the transcript's bottom; keep the starters clear of it. */
  bottomInsetPx: number;
  /** The selection's context bar, floating above the composer outside its inset. */
  contextBarHeightPx: number;
  /** Writes the starter's prompt into the composer without sending it. */
  onStarter: (prompt: string) => void;
}

/**
 * How much of the writing-partner view fits above the composer, roomiest
 * first. Each step gives up the least useful part and keeps all four starters
 * whole and clickable: the italic examples go (single-line cards), then the
 * hint (the starters become pills), then the title and the selection chip
 * (the composer's context bar still names the selection), then the pills'
 * labels (one row of the icons the editor's selection toolbar uses, named in
 * their tooltips). Only when even that row does not fit does the view scroll.
 */
const DENSITIES = ["full", "compact", "chips", "bare", "icons"] as const;
type Density = (typeof DENSITIES)[number];

// The view sits this far clear of the composer's top edge.
const COMPOSER_GAP_PX = 8;

const STARTER_SURFACE_CLASS_NAME =
  "lattice-starter bg-[var(--lattice-starter-surface)] shadow-[inset_0_0_0_1px_var(--color-border)] transition-[background-color,box-shadow] duration-150 ease-out hover:bg-[var(--lattice-starter-surface-hover)] hover:shadow-[inset_0_0_0_1px_var(--lattice-settings-line-strong,var(--color-border))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none";

export const LatticeEmptyThread = memo(function LatticeEmptyThread({
  bottomInsetPx,
  contextBarHeightPx,
  onStarter,
}: LatticeEmptyThreadProps) {
  const context = useSyncExternalStore(
    subscribeLiveLatticeHostContext,
    getLiveLatticeHostContext,
    getLiveLatticeHostContext,
  );
  const selectionPlace = latticeSelectionPlace(context, i18n);
  const hasSelection = selectionPlace !== null;

  // A fit pass starts from the roomiest density and steps down, one render at
  // a time inside the same layout phase, until the view fits; the generation
  // restarts it without first having to leave density 0.
  const [fit, setFit] = useState({ step: 0, generation: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const density: Density = DENSITIES[fit.step] ?? "full";
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || fit.step >= DENSITIES.length - 1) return;
    if (
      viewport.scrollHeight > viewport.clientHeight + 1 ||
      viewport.scrollWidth > viewport.clientWidth + 1
    ) {
      setFit((current) => ({ ...current, step: current.step + 1 }));
    }
  }, [fit]);
  const refit = useCallback(() => {
    setFit((current) => ({ step: 0, generation: current.generation + 1 }));
  }, []);
  // What changes the content's size without resizing the viewport.
  const selectionKey = selectionPlace ? `${selectionPlace.name}|${selectionPlace.detail}` : "";
  useLayoutEffect(refit, [refit, selectionKey, i18n.locale]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let disposed = false;
    // The serif may arrive after the first fit and set taller lines.
    void document.fonts?.ready.then(() => {
      if (!disposed) refit();
    });
    if (typeof ResizeObserver === "undefined") {
      return () => {
        disposed = true;
      };
    }
    // Refit before the resized frame paints, so a panel being dragged
    // shorter never shows a starter under the composer, even for a frame.
    // The border box ignores the padding a density sets.
    const observer = new ResizeObserver(() => flushSync(refit));
    observer.observe(viewport, { box: "border-box" });
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [refit]);

  const showTitle = density === "full" || density === "compact" || density === "chips";
  const showHint = density === "full" || density === "compact";
  const showChip = showTitle && selectionPlace !== null;

  const starter = (kind: LatticeStarterKind) => {
    const Icon = STARTER_ICONS[kind];
    const copy = latticeStarterCopy(kind, i18n);
    const onClick = () => onStarter(latticeStarterPrompt(kind, hasSelection, i18n));
    if (density === "icons") {
      return (
        <li key={kind} className="flex">
          <button
            type="button"
            data-starter={kind}
            aria-label={copy.title}
            title={`${copy.title} · ${copy.example}`}
            className={`${STARTER_SURFACE_CLASS_NAME} grid size-7 place-items-center rounded-full`}
            onClick={onClick}
          >
            <Icon className="lattice-starter-glyph size-3.5" />
          </button>
        </li>
      );
    }
    if (density === "chips" || density === "bare") {
      // A pill names its example in the tooltip the card would show.
      return (
        <li key={kind} className="flex max-w-full">
          <button
            type="button"
            data-starter={kind}
            title={copy.example}
            className={`${STARTER_SURFACE_CLASS_NAME} flex h-7 max-w-full items-center gap-1.5 rounded-full pr-3 pl-2 text-[12.5px] leading-4 font-medium text-foreground`}
            onClick={onClick}
          >
            <Icon className="lattice-starter-glyph size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{copy.title}</span>
          </button>
        </li>
      );
    }
    const compact = density === "compact";
    return (
      <li key={kind} className="flex min-w-0">
        <button
          type="button"
          data-starter={kind}
          title={compact ? copy.example : undefined}
          className={`${STARTER_SURFACE_CLASS_NAME} group flex w-full min-w-0 gap-2.5 rounded-[10px] text-left ${compact ? "items-center p-1.5 pr-2.5" : "items-start p-2.5"}`}
          onClick={onClick}
        >
          <span
            aria-hidden="true"
            className={`lattice-starter-icon grid shrink-0 place-items-center ${compact ? "size-6 rounded-[6px]" : "size-7 rounded-[7px]"}`}
          >
            <Icon className={compact ? "size-3.5" : "size-[15px]"} />
          </span>
          {compact ? (
            <span className="min-w-0 truncate text-[13px] leading-[18px] font-medium text-foreground">
              {copy.title}
            </span>
          ) : (
            <span className="flex min-w-0 flex-col gap-0.5 pt-px">
              <span className="text-[13px] leading-[18px] font-medium text-foreground">
                {copy.title}
              </span>
              <span className="lattice-starter-example text-[12.5px] leading-[17px] text-muted-foreground">
                {copy.example}
              </span>
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div
      data-testid="lattice-empty-thread"
      data-selection={hasSelection ? "true" : undefined}
      data-density={density}
      // Stretched over the transcript; the viewport inside fills the space
      // above the composer (its top edge is the inset plus the tuck the
      // transcript slides under it) and any context bar on it, centred there, and scrolls there as a
      // last resort, so no starter ever slides under the composer. The
      // viewport is positioned rather than in flow: the timeline's empty-state
      // row keeps `min-height: auto`, so in-flow content would stretch it past
      // the panel and push the starters under the composer anyway.
      className="lattice-empty-thread relative w-full max-w-[560px] self-stretch select-none"
    >
      <div
        ref={viewportRef}
        className={`absolute inset-x-0 top-0 flex flex-col overflow-y-auto px-4 @container ${density === "icons" ? "pt-1" : "pt-3"}`}
        style={{
          bottom: bottomInsetPx + COMPOSER_OVERLAY_TUCK_PX + contextBarHeightPx + COMPOSER_GAP_PX,
        }}
      >
        {/* my-auto centres the view while it fits and pins it to the top
            once it scrolls, where justify-center would clip its top. */}
        <div className="my-auto">
          {showTitle ? (
            <h2
              className={`lattice-empty-thread-title font-normal text-balance text-foreground ${density === "chips" ? "text-[17px] leading-[22px]" : "text-[21px] leading-[26px]"}`}
            >
              {i18n._("Work on this paper")}
            </h2>
          ) : null}
          {/* Chinese wraps at its punctuation, not between any two characters,
              so a narrow panel never splits a word such as 编辑器. */}
          {showHint ? (
            <p className="mt-1.5 text-[12.5px] leading-[18px] text-balance break-keep text-muted-foreground">
              {hasSelection
                ? i18n._("These act on the selected text only")
                : i18n._("To work on a single passage, select it in the editor")}
            </p>
          ) : null}
          {showChip && selectionPlace ? (
            <div
              data-testid="lattice-empty-thread-selection"
              className={`${showHint ? "mt-3" : "mt-2"} inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-[var(--lattice-starter-chip-surface)] pr-2.5 pl-2 text-[11.5px] leading-4 text-[var(--color-text-foreground-secondary)] shadow-[inset_0_0_0_1px_var(--color-border)]`}
            >
              <TextSelectIcon className="size-3.5 shrink-0 text-[var(--color-text-foreground-tertiary)]" />
              {/* The lines never give way to the file name. Below a 200px column
                  the label and the name go (the context bar and the tooltip keep
                  the name), and only then may the lines ellipsize. */}
              <span className="shrink-0 font-medium text-foreground/85 @max-[200px]:hidden">
                {i18n._("Selection")}
              </span>
              <span
                aria-hidden="true"
                className="shrink-0 text-[var(--color-text-foreground-tertiary)] @max-[200px]:hidden"
              >
                ·
              </span>
              <span
                className={`min-w-0 truncate ${selectionPlace.detail ? "@max-[200px]:hidden" : ""}`}
                title={selectionPlace.name}
              >
                {selectionPlace.name}
              </span>
              {selectionPlace.detail ? (
                <span
                  className="shrink-0 truncate @max-[200px]:min-w-0 @max-[200px]:shrink"
                  title={selectionPlace.name}
                >
                  {selectionPlace.detail}
                </span>
              ) : null}
            </div>
          ) : null}
          <ul
            className={
              density === "full"
                ? "mt-4 grid grid-cols-1 gap-2 @[400px]:grid-cols-2"
                : density === "compact"
                  ? "mt-3 grid grid-cols-1 gap-1.5 @[340px]:grid-cols-2"
                  : density === "chips"
                    ? "mt-3 flex flex-wrap gap-1.5"
                    : "flex flex-wrap gap-1.5"
            }
          >
            {LATTICE_STARTER_KINDS.map(starter)}
          </ul>
        </div>
      </div>
    </div>
  );
});

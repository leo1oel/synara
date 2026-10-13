// FILE: LatticeEmptyThread.tsx
// Purpose: The embedded (Lattice) Agent panel's empty thread: the agent as a
// writing partner, with starters that mirror the editor's selection actions.
// Layer: Chat presentation
// Depends on: Lattice's live host context for the selection chip.

import { memo, useSyncExternalStore, type FC, type SVGProps } from "react";

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
  /** Writes the starter's prompt into the composer without sending it. */
  onStarter: (prompt: string) => void;
}

export const LatticeEmptyThread = memo(function LatticeEmptyThread({
  bottomInsetPx,
  onStarter,
}: LatticeEmptyThreadProps) {
  const context = useSyncExternalStore(
    subscribeLiveLatticeHostContext,
    getLiveLatticeHostContext,
    getLiveLatticeHostContext,
  );
  const selectionPlace = latticeSelectionPlace(context, i18n);
  const hasSelection = selectionPlace !== null;

  return (
    <div
      data-testid="lattice-empty-thread"
      data-selection={hasSelection ? "true" : undefined}
      // Centred in the space above the composer, and scrolling there when the
      // panel is too short, so no starter slides under it. A selection adds
      // Lattice's context bar, which floats above the composer outside its
      // measured height.
      className="lattice-empty-thread w-full max-w-[560px] overflow-y-auto px-4 py-4 select-none @container"
      style={{
        marginBottom: bottomInsetPx + (hasSelection ? 40 : 0),
        maxHeight: `calc(100% - ${bottomInsetPx + (hasSelection ? 40 : 0)}px)`,
      }}
    >
      <h2 className="lattice-empty-thread-title text-[21px] leading-[26px] font-normal text-balance text-foreground">
        {i18n._("Work on this paper")}
      </h2>
      {/* Chinese wraps at its punctuation, not between any two characters,
          so a narrow panel never splits a word such as 编辑器. */}
      <p className="mt-1.5 text-[12.5px] leading-[18px] text-balance break-keep text-muted-foreground">
        {hasSelection
          ? i18n._("These act on the selected text only")
          : i18n._("To work on a single passage, select it in the editor")}
      </p>
      {selectionPlace ? (
        <div
          data-testid="lattice-empty-thread-selection"
          className="mt-3 inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-[var(--lattice-starter-chip-surface)] pr-2.5 pl-2 text-[11.5px] leading-4 text-[var(--color-text-foreground-secondary)] shadow-[inset_0_0_0_1px_var(--color-border)]"
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
      <ul className="mt-4 grid grid-cols-1 gap-2 @[400px]:grid-cols-2">
        {LATTICE_STARTER_KINDS.map((kind) => {
          const Icon = STARTER_ICONS[kind];
          const copy = latticeStarterCopy(kind, i18n);
          return (
            <li key={kind} className="flex">
              <button
                type="button"
                data-starter={kind}
                className="lattice-starter group flex w-full items-start gap-2.5 rounded-[10px] bg-[var(--lattice-starter-surface)] p-2.5 text-left shadow-[inset_0_0_0_1px_var(--color-border)] transition-[background-color,box-shadow] duration-150 ease-out hover:bg-[var(--lattice-starter-surface-hover)] hover:shadow-[inset_0_0_0_1px_var(--lattice-settings-line-strong,var(--color-border))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none"
                onClick={() => onStarter(latticeStarterPrompt(kind, hasSelection, i18n))}
              >
                <span
                  aria-hidden="true"
                  className="lattice-starter-icon grid size-7 shrink-0 place-items-center rounded-[7px]"
                >
                  <Icon className="size-[15px]" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5 pt-px">
                  <span className="text-[13px] leading-[18px] font-medium text-foreground">
                    {copy.title}
                  </span>
                  <span className="lattice-starter-example text-[12.5px] leading-[17px] text-muted-foreground">
                    {copy.example}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
});

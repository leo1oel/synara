import type { LatticeHostContextSnapshot } from "../../embedMode";
import { t } from "../../i18n";

/** The editor's selection actions, mirrored as starters with the same icons. */
export type LatticeStarterKind = "polish" | "revise" | "proofread" | "references";

export const LATTICE_STARTER_KINDS: readonly LatticeStarterKind[] = [
  "polish",
  "revise",
  "proofread",
  "references",
];

export interface LatticeStarterCopy {
  title: string;
  /** What the writer might say; shown on the card in the reading serif. */
  example: string;
}

export function latticeStarterCopy(
  kind: LatticeStarterKind,
  translate: typeof t = t,
): LatticeStarterCopy {
  switch (kind) {
    case "polish":
      return {
        title: translate("lattice:polish"),
        example: translate("lattice:polishThisParagraph"),
      };
    case "revise":
      return {
        title: translate("lattice:revise"),
        example: translate("lattice:reviseToAddressAReviewComment"),
      };
    case "proofread":
      return {
        title: translate("lattice:proofread"),
        example: translate("lattice:proofreadGrammarAndSpelling"),
      };
    case "references":
      return {
        title: translate("lattice:checkReferences"),
        example: translate("lattice:checkMyReferences"),
      };
  }
}

/**
 * The editing instruction a starter writes into the composer. It is not sent:
 * the writer finishes it (Revise ends where the review comment goes) and sends
 * it. With a selection it targets only the selected text, which Lattice
 * attaches to the message as host context.
 */
export function latticeStarterPrompt(
  kind: LatticeStarterKind,
  hasSelection: boolean,
  translate: typeof t = t,
): string {
  switch (kind) {
    case "polish":
      return hasSelection
        ? translate("lattice:polishTheSelectedTextForClarityAnd")
        : translate("lattice:polishTheParagraphAtMyCursorFor");
    case "revise":
      return hasSelection
        ? translate("lattice:reviseTheSelectedTextToAddressThis")
        : translate("lattice:reviseThePaperToAddressThisReview");
    case "proofread":
      return hasSelection
        ? translate("lattice:proofreadTheSelectedTextAndFixGrammar")
        : translate("lattice:proofreadTheSectionAtMyCursorAnd");
    case "references":
      return hasSelection
        ? translate("lattice:checkTheCitationsInTheSelectedText")
        : translate("lattice:checkTheCitationsInThisPaperEvery");
  }
}

function basename(path: string): string {
  return path.replaceAll("\\", "/").split("/").findLast(Boolean) ?? path;
}

/** Where the live selection is, for the chip: a name that may truncate, and a place that must not. */
export interface LatticeSelectionPlace {
  name: string;
  detail: string | null;
}

/**
 * Where the live selection is: "main.tex" + "lines 23–25" from the editor, a
 * PDF page, a paper or a slide. Null without a selection. A Lattice that
 * predates `selectionLines` gets the file name alone.
 */
export function latticeSelectionPlace(
  context: LatticeHostContextSnapshot | null,
  translate: typeof t = t,
): LatticeSelectionPlace | null {
  if (!context) return null;
  if (context.presentation?.selection) {
    return { name: context.presentation.slideTitle || translate("lattice:slides"), detail: null };
  }
  const editor = context.editor?.selection ? context.editor : null;
  const pdf = context.pdf?.selection ? context.pdf : null;
  const paper = context.paper?.selection ? context.paper : null;
  // The surface being worked in wins when two hold a selection, as in the composer.
  const surface =
    context.activeSurface === "pdf" && pdf
      ? "pdf"
      : context.activeSurface === "paper" && paper
        ? "paper"
        : editor
          ? "editor"
          : pdf
            ? "pdf"
            : paper
              ? "paper"
              : null;
  if (surface === "editor" && editor) {
    const lines = editor.selectionLines;
    return {
      name: basename(editor.path),
      detail: !lines
        ? null
        : lines.start === lines.end
          ? translate("workspace:selectionLine", { location: lines.start })
          : translate("lattice:lines", { start: lines.start, end: lines.end }),
    };
  }
  if (surface === "pdf" && pdf) {
    return { name: "PDF", detail: translate("lattice:page", { page: pdf.page }) };
  }
  if (surface === "paper" && paper) return { name: paper.title, detail: null };
  return null;
}

/**
 * The composer text after choosing a starter: the starter's prompt replaces an
 * empty draft or another starter's untouched prompt, and follows anything the
 * writer typed themselves rather than discarding it.
 */
export function latticeStarterDraft(
  current: string,
  prompt: string,
  translate: typeof t = t,
): string {
  const typed = current.trim();
  const isStarterPrompt = LATTICE_STARTER_KINDS.some((kind) =>
    [true, false].some(
      (hasSelection) => latticeStarterPrompt(kind, hasSelection, translate).trim() === typed,
    ),
  );
  return !typed || isStarterPrompt ? prompt : `${current.trimEnd()}\n\n${prompt}`;
}

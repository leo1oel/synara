// FILE: LatticeEmptyThread.logic.ts
// Purpose: The Lattice empty thread's starters and selection chip: which
// editing prompt each starter writes into the composer, and how the live
// host selection is named.
// Layer: Chat presentation logic

import type { I18n } from "@lingui/core";

import type { LatticeHostContextSnapshot } from "../../embedMode";
import { i18n as appI18n } from "../../i18n";

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
  i18n: I18n = appI18n,
): LatticeStarterCopy {
  switch (kind) {
    case "polish":
      return { title: i18n._("Polish"), example: i18n._("Polish this paragraph") };
    case "revise":
      return { title: i18n._("Revise"), example: i18n._("Revise to address a review comment") };
    case "proofread":
      return { title: i18n._("Proofread"), example: i18n._("Proofread grammar and spelling") };
    case "references":
      return { title: i18n._("Check references"), example: i18n._("Check my references") };
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
  i18n: I18n = appI18n,
): string {
  switch (kind) {
    case "polish":
      return hasSelection
        ? i18n._(
            "Polish the selected text for clarity and flow. Keep its meaning, citations and LaTeX commands unchanged.",
          )
        : i18n._(
            "Polish the paragraph at my cursor for clarity and flow. Keep its meaning, citations and LaTeX commands unchanged.",
          );
    case "revise":
      return hasSelection
        ? i18n._("Revise the selected text to address this review comment: ")
        : i18n._("Revise the paper to address this review comment: ");
    case "proofread":
      return hasSelection
        ? i18n._(
            "Proofread the selected text and fix grammar, spelling and punctuation. Leave the wording otherwise unchanged.",
          )
        : i18n._(
            "Proofread the section at my cursor and fix grammar, spelling and punctuation. Leave the wording otherwise unchanged.",
          );
    case "references":
      return hasSelection
        ? i18n._(
            "Check the citations in the selected text: every \\cite key should exist in the bibliography with accurate details, and each cited work should support its claim. Fix what is wrong.",
          )
        : i18n._(
            "Check the citations in this paper: every \\cite key should exist in the bibliography with accurate details, and each cited work should support its claim. Fix what is wrong.",
          );
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
  i18n: I18n = appI18n,
): LatticeSelectionPlace | null {
  if (!context) return null;
  if (context.presentation?.selection) {
    return { name: context.presentation.slideTitle || i18n._("Slides"), detail: null };
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
          ? i18n._("line {line}", { line: lines.start })
          : i18n._("lines {start}–{end}", { start: lines.start, end: lines.end }),
    };
  }
  if (surface === "pdf" && pdf) {
    return { name: "PDF", detail: i18n._("page {page}", { page: pdf.page }) };
  }
  if (surface === "paper" && paper) return { name: paper.title, detail: null };
  return null;
}

/**
 * The composer text after choosing a starter: the starter's prompt replaces an
 * empty draft or another starter's untouched prompt, and follows anything the
 * writer typed themselves rather than discarding it.
 */
export function latticeStarterDraft(current: string, prompt: string, i18n: I18n = appI18n): string {
  const typed = current.trim();
  const isStarterPrompt = LATTICE_STARTER_KINDS.some((kind) =>
    [true, false].some(
      (hasSelection) => latticeStarterPrompt(kind, hasSelection, i18n).trim() === typed,
    ),
  );
  return !typed || isStarterPrompt ? prompt : `${current.trimEnd()}\n\n${prompt}`;
}

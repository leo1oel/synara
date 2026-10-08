// FILE: ComposerLatticeContextBar.logic.ts
// Purpose: Converts Lattice's live host snapshot into compact, user-facing
// composer context labels without leaking protocol details into the component.
// Layer: Chat composer presentation logic

import type { I18n } from "@lingui/core";

import type { LatticeHostContextSnapshot, LatticeHostSurface } from "../../embedMode";
import { i18n as appI18n } from "../../i18n";

export interface LatticeContextDetail {
  label: string;
  value: string;
}

export interface LatticeContextSelection {
  source: LatticeHostSurface | "presentation";
  label: string;
  text: string;
  length: number;
}

function basename(path: string): string {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

function pageLabel(i18n: I18n, page: number, pageCount: number | null): string {
  return pageCount
    ? i18n._("Page {page} of {pageCount}", { page, pageCount })
    : i18n._("Page {page}", { page });
}

export function latticeContextSummary(
  context: LatticeHostContextSnapshot,
  i18n: I18n = appI18n,
): string {
  if (context.presentation) {
    return `${i18n._("Slides")} · ${context.presentation.slideTitle} · ${pageLabel(
      i18n,
      context.presentation.pageNumber,
      context.presentation.totalPages,
    )}`;
  }
  if (context.activeSurface === "paper" && context.paper) {
    return `${i18n._("Paper")} · ${context.paper.title}`;
  }
  if (context.activeSurface === "pdf" && context.pdf) {
    return `PDF · ${pageLabel(i18n, context.pdf.page, context.pdf.pageCount)}`;
  }
  if (context.editor) {
    return `${basename(context.editor.path)} · ${i18n._("Line {line}", { line: context.editor.line })}`;
  }
  return i18n._("Active project");
}

export function latticeContextSelection(
  context: LatticeHostContextSnapshot,
  i18n: I18n = appI18n,
): LatticeContextSelection | null {
  if (context.presentation?.selection) {
    const selection = context.presentation.selection;
    const text = selection.text.trim() || `<${selection.tagName}>`;
    return {
      source: "presentation",
      label: i18n._("Slide element"),
      text,
      length: text.length,
    };
  }
  const candidates: ReadonlyArray<{
    source: LatticeHostSurface;
    label: string;
    text: string | undefined;
  }> = [
    { source: "paper", label: i18n._("Paper selection"), text: context.paper?.selection },
    { source: "pdf", label: i18n._("PDF selection"), text: context.pdf?.selection },
    { source: "editor", label: i18n._("Editor selection"), text: context.editor?.selection },
  ];
  const selected = candidates.find((candidate) => candidate.text);
  return selected?.text
    ? {
        source: selected.source,
        label: selected.label,
        text: selected.text,
        length: selected.text.length,
      }
    : null;
}

export function latticeContextDetails(
  context: LatticeHostContextSnapshot,
  i18n: I18n = appI18n,
): LatticeContextDetail[] {
  const details: LatticeContextDetail[] = [
    {
      label: i18n._("Active view"),
      value: context.presentation
        ? i18n._("Slides")
        : context.activeSurface === "paper"
          ? i18n._("Paper")
          : context.activeSurface === "pdf"
            ? "PDF"
            : i18n._("Editor"),
    },
    { label: i18n._("Workspace"), value: context.workspaceRoot },
  ];

  if (context.presentation) {
    details.push(
      { label: i18n._("Presentation"), value: context.presentation.slideTitle },
      {
        label: i18n._("Slide"),
        value: pageLabel(i18n, context.presentation.pageNumber, context.presentation.totalPages),
      },
    );
    if (context.presentation.selection) {
      const selection = context.presentation.selection;
      details.push({
        label: i18n._("Selected element"),
        value: `<${selection.tagName}> · ${i18n._("Line {line}, column {column}", {
          line: selection.line,
          column: selection.column,
        })}`,
      });
    }
  }
  if (context.editor) {
    details.push({
      label: i18n._("Editor"),
      value: `${context.editor.path} · ${i18n._("Line {line}, column {column}", {
        line: context.editor.line,
        column: context.editor.column,
      })}`,
    });
    if (context.editor.secondaryPath) {
      details.push({ label: i18n._("Second editor"), value: context.editor.secondaryPath });
    }
  }
  if (context.pdf) {
    details.push({
      label: "PDF",
      value: pageLabel(i18n, context.pdf.page, context.pdf.pageCount),
    });
  }
  if (context.paper) {
    details.push(
      { label: i18n._("Paper"), value: context.paper.title },
      { label: i18n._("Paper source"), value: context.paper.path },
      { label: "arXiv", value: context.paper.arxivId },
      {
        label: i18n._("Reading view"),
        value: context.paper.view === "blog" ? i18n._("Blog") : i18n._("Full text"),
      },
    );
    if (context.paper.citationKey) {
      details.push({ label: i18n._("Citation key"), value: context.paper.citationKey });
    }
  }

  return details;
}

export { clearLatticeContextSelection } from "../../lib/latticeHostContext";

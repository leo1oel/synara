// FILE: ComposerLatticeContextBar.logic.ts
// Purpose: Converts Lattice's live host snapshot into compact, user-facing
// composer context labels without leaking protocol details into the component.
// Layer: Chat composer presentation logic

import type { LatticeHostContextSnapshot, LatticeHostSurface } from "../../embedMode";

export interface LatticeContextDetail {
  label: string;
  value: string;
}

export interface LatticeContextSelection {
  source: LatticeHostSurface;
  label: string;
  text: string;
  length: number;
}

function basename(path: string): string {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

function pageLabel(page: number, pageCount: number | null): string {
  return pageCount ? `Page ${page} of ${pageCount}` : `Page ${page}`;
}

export function latticeContextSummary(context: LatticeHostContextSnapshot): string {
  if (context.activeSurface === "paper" && context.paper) {
    return `Paper · ${context.paper.title}`;
  }
  if (context.activeSurface === "pdf" && context.pdf) {
    return `PDF · ${pageLabel(context.pdf.page, context.pdf.pageCount)}`;
  }
  if (context.editor) {
    return `${basename(context.editor.path)} · Line ${context.editor.line}`;
  }
  return "Active project";
}

export function latticeContextSelection(
  context: LatticeHostContextSnapshot,
): LatticeContextSelection | null {
  const candidates: ReadonlyArray<{
    source: LatticeHostSurface;
    label: string;
    text: string | undefined;
  }> = [
    { source: "paper", label: "Paper selection", text: context.paper?.selection },
    { source: "pdf", label: "PDF selection", text: context.pdf?.selection },
    { source: "editor", label: "Editor selection", text: context.editor?.selection },
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
): LatticeContextDetail[] {
  const details: LatticeContextDetail[] = [
    {
      label: "Active view",
      value:
        context.activeSurface === "paper"
          ? "Paper"
          : context.activeSurface === "pdf"
            ? "PDF"
            : "Editor",
    },
    { label: "Workspace", value: context.workspaceRoot },
  ];

  if (context.editor) {
    details.push({
      label: "Editor",
      value: `${context.editor.path} · Line ${context.editor.line}, column ${context.editor.column}`,
    });
    if (context.editor.secondaryPath) {
      details.push({ label: "Second editor", value: context.editor.secondaryPath });
    }
  }
  if (context.pdf) {
    details.push({
      label: "PDF",
      value: pageLabel(context.pdf.page, context.pdf.pageCount),
    });
  }
  if (context.paper) {
    details.push(
      { label: "Paper", value: context.paper.title },
      { label: "Paper source", value: context.paper.path },
      { label: "arXiv", value: context.paper.arxivId },
      { label: "Reading view", value: context.paper.view === "blog" ? "Blog" : "Full text" },
    );
    if (context.paper.citationKey) {
      details.push({ label: "Citation key", value: context.paper.citationKey });
    }
  }

  return details;
}

export function clearLatticeContextSelection(
  context: LatticeHostContextSnapshot,
): LatticeHostContextSnapshot {
  const withoutSelection = <T extends { selection?: string }>(value: T): T => {
    const clone = { ...value };
    delete clone.selection;
    return clone;
  };
  return {
    ...context,
    ...(context.editor
      ? { editor: withoutSelection(context.editor) }
      : {}),
    ...(context.pdf ? { pdf: withoutSelection(context.pdf) } : {}),
    ...(context.paper ? { paper: withoutSelection(context.paper) } : {}),
  };
}

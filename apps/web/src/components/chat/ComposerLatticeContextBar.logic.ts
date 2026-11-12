import type { LatticeHostContextSnapshot, LatticeHostSurface } from "../../embedMode";
import { t } from "../../i18n";

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

function pageLabel(translate: typeof t, page: number, pageCount: number | null): string {
  return pageCount
    ? translate("lattice:pageOf", { page, pageCount })
    : translate("common:page2", { value0: page });
}

export function latticeContextSummary(
  context: LatticeHostContextSnapshot,
  translate: typeof t = t,
): string {
  if (context.presentation) {
    return `${translate("lattice:slides")} · ${context.presentation.slideTitle} · ${pageLabel(
      translate,
      context.presentation.pageNumber,
      context.presentation.totalPages,
    )}`;
  }
  if (context.activeSurface === "paper" && context.paper) {
    return `${translate("lattice:paper")} · ${context.paper.title}`;
  }
  if (context.activeSurface === "pdf" && context.pdf) {
    return `PDF · ${pageLabel(translate, context.pdf.page, context.pdf.pageCount)}`;
  }
  if (context.editor) {
    return `${basename(context.editor.path)} · ${translate("lattice:line", { line: context.editor.line })}`;
  }
  return translate("lattice:activeProject");
}

export function latticeContextSelection(
  context: LatticeHostContextSnapshot,
  translate: typeof t = t,
): LatticeContextSelection | null {
  if (context.presentation?.selection) {
    const selection = context.presentation.selection;
    const text = selection.text.trim() || `<${selection.tagName}>`;
    return {
      source: "presentation",
      label: translate("lattice:slideElement"),
      text,
      length: text.length,
    };
  }
  const candidates: ReadonlyArray<{
    source: LatticeHostSurface;
    label: string;
    text: string | undefined;
  }> = [
    { source: "paper", label: translate("lattice:paperSelection"), text: context.paper?.selection },
    { source: "pdf", label: translate("lattice:pDFSelection"), text: context.pdf?.selection },
    {
      source: "editor",
      label: translate("lattice:editorSelection"),
      text: context.editor?.selection,
    },
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
  translate: typeof t = t,
): LatticeContextDetail[] {
  const details: LatticeContextDetail[] = [
    {
      label: translate("lattice:activeView"),
      value: context.presentation
        ? translate("lattice:slides")
        : context.activeSurface === "paper"
          ? translate("lattice:paper")
          : context.activeSurface === "pdf"
            ? "PDF"
            : translate("chat:general_editor"),
    },
    { label: translate("workspace:editor_workspaceLabel"), value: context.workspaceRoot },
  ];

  if (context.presentation) {
    details.push(
      { label: translate("lattice:presentation"), value: context.presentation.slideTitle },
      {
        label: translate("lattice:slide"),
        value: pageLabel(
          translate,
          context.presentation.pageNumber,
          context.presentation.totalPages,
        ),
      },
    );
    if (context.presentation.selection) {
      const selection = context.presentation.selection;
      details.push({
        label: translate("lattice:selectedElement"),
        value: `<${selection.tagName}> · ${translate("lattice:lineColumn", { line: selection.line, column: selection.column })}`,
      });
    }
    const commentCount = context.presentation.pendingComments?.length ?? 0;
    if (commentCount > 0) {
      details.push({
        label: translate("lattice:slideComments"),
        value:
          commentCount === 1
            ? translate("lattice:n1Comment")
            : translate("lattice:comments", { count: commentCount }),
      });
    }
  }
  if (context.editor) {
    details.push({
      label: translate("chat:general_editor"),
      value: `${context.editor.path} · ${translate("lattice:lineColumn", { line: context.editor.line, column: context.editor.column })}`,
    });
    if (context.editor.secondaryPath) {
      details.push({
        label: translate("lattice:secondEditor"),
        value: context.editor.secondaryPath,
      });
    }
  }
  if (context.pdf) {
    details.push({
      label: "PDF",
      value: pageLabel(translate, context.pdf.page, context.pdf.pageCount),
    });
  }
  if (context.paper) {
    details.push(
      { label: translate("lattice:paper"), value: context.paper.title },
      { label: translate("lattice:paperSource"), value: context.paper.path },
      { label: "arXiv", value: context.paper.arxivId },
      {
        label: translate("lattice:readingView"),
        value:
          context.paper.view === "blog" ? translate("lattice:blog") : translate("lattice:fullText"),
      },
    );
    if (context.paper.citationKey) {
      details.push({ label: translate("lattice:citationKey"), value: context.paper.citationKey });
    }
  }

  return details;
}

export { clearLatticeContextSelection } from "../../lib/latticeHostContext";

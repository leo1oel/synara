// FILE: ComposerLatticeContextBar.logic.test.ts
// Purpose: Pins the exact context summary, detail, and selection-clear semantics.

import { describe, expect, it } from "vitest";

import { LATTICE_HOST_CONTEXT, type LatticeHostContextSnapshot } from "../../embedMode";
import {
  clearLatticeContextSelection,
  latticeContextDetails,
  latticeContextSelection,
  latticeContextSummary,
} from "./ComposerLatticeContextBar.logic";

const editorContext: LatticeHostContextSnapshot = {
  type: LATTICE_HOST_CONTEXT,
  version: 1,
  workspaceRoot: "/Users/me/paper",
  activeSurface: "editor",
  editor: {
    path: "sections/introduction.tex",
    line: 42,
    column: 7,
    secondaryPath: "references.tex",
    selection: "Selected claim",
  },
  pdf: { page: 4, pageCount: 12 },
};

const presentationContext: LatticeHostContextSnapshot = {
  type: LATTICE_HOST_CONTEXT,
  version: 1,
  workspaceRoot: "/Users/me/paper",
  activeSurface: "editor",
  editor: {
    path: "slides/research-update/index.tsx",
    line: 1,
    column: 0,
  },
  presentation: {
    slideId: "research-update",
    pageIndex: 2,
    pageNumber: 3,
    totalPages: 8,
    slideTitle: "Research update",
    view: "slides",
    pagePath: "slides/research-update/index.tsx",
    selection: { line: 42, column: 6, tagName: "h1", text: "Q2 Roadmap" },
    updatedAt: "2026-09-04T12:00:00.000Z",
  },
};

describe("ComposerLatticeContextBar presentation", () => {
  it("summarizes the active editor and exposes every injected field", () => {
    expect(latticeContextSummary(editorContext)).toBe("introduction.tex · Line 42");
    expect(latticeContextSelection(editorContext)).toEqual({
      source: "editor",
      label: "Editor selection",
      text: "Selected claim",
      length: 14,
    });
    expect(latticeContextDetails(editorContext)).toEqual([
      { label: "Active view", value: "Editor" },
      { label: "Workspace", value: "/Users/me/paper" },
      {
        label: "Editor",
        value: "sections/introduction.tex · Line 42, column 7",
      },
      { label: "Second editor", value: "references.tex" },
      { label: "PDF", value: "Page 4 of 12" },
    ]);
  });

  it("prioritizes paper and PDF summaries for their active surfaces", () => {
    const pdfContext = { ...editorContext, activeSurface: "pdf" as const };
    expect(latticeContextSummary(pdfContext)).toBe("PDF · Page 4 of 12");

    const paperContext: LatticeHostContextSnapshot = {
      type: LATTICE_HOST_CONTEXT,
      version: 1,
      workspaceRoot: "/Users/me/paper",
      activeSurface: "paper",
      paper: {
        title: "Attention Is All You Need",
        arxivId: "1706.03762",
        citationKey: "vaswani2017attention",
        path: ".research/papers/1706.03762/paper.md",
        view: "fulltext",
        selection: "Multi-head attention",
      },
    };
    expect(latticeContextSummary(paperContext)).toBe("Paper · Attention Is All You Need");
    expect(latticeContextSelection(paperContext)?.label).toBe("Paper selection");
    expect(latticeContextDetails(paperContext)).toContainEqual({
      label: "Citation key",
      value: "vaswani2017attention",
    });
  });

  it("shows the live Open Slide page and selected element", () => {
    expect(latticeContextSummary(presentationContext)).toBe(
      "Slides · Research update · Page 3 of 8",
    );
    expect(latticeContextSelection(presentationContext)).toEqual({
      source: "presentation",
      label: "Slide element",
      text: "Q2 Roadmap",
      length: 10,
    });
    expect(latticeContextDetails(presentationContext)).toContainEqual({
      label: "Active view",
      value: "Slides",
    });
    expect(latticeContextDetails(presentationContext)).toContainEqual({
      label: "Selected element",
      value: "<h1> · Line 42, column 6",
    });
    expect(
      latticeContextSelection({
        ...presentationContext,
        presentation: {
          ...presentationContext.presentation!,
          selection: { line: 42, column: 6, tagName: "h1", text: "" },
        },
      })?.text,
    ).toBe("<h1>");
  });

  it("clears only explicit selections and preserves ambient context", () => {
    const cleared = clearLatticeContextSelection(editorContext);

    expect(latticeContextSelection(cleared)).toBeNull();
    expect(cleared.editor?.path).toBe("sections/introduction.tex");
    expect(cleared.pdf).toEqual({ page: 4, pageCount: 12 });

    const clearedPresentation = clearLatticeContextSelection(presentationContext);
    expect(latticeContextSelection(clearedPresentation)).toBeNull();
    expect(clearedPresentation.presentation?.pageNumber).toBe(3);
  });
});

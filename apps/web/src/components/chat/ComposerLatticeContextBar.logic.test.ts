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
    expect(latticeContextSummary(paperContext)).toBe(
      "Paper · Attention Is All You Need",
    );
    expect(latticeContextSelection(paperContext)?.label).toBe("Paper selection");
    expect(latticeContextDetails(paperContext)).toContainEqual({
      label: "Citation key",
      value: "vaswani2017attention",
    });
  });

  it("clears only explicit selections and preserves ambient context", () => {
    const cleared = clearLatticeContextSelection(editorContext);

    expect(latticeContextSelection(cleared)).toBeNull();
    expect(cleared.editor?.path).toBe("sections/introduction.tex");
    expect(cleared.pdf).toEqual({ page: 4, pageCount: 12 });
  });
});

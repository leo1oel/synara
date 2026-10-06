// FILE: ComposerLatticeContextBar.test.tsx
// Purpose: Guards the visible disclosure copy and exact selection preview.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LATTICE_HOST_CONTEXT } from "../../embedMode";
import { setLiveLatticeHostContext } from "../../lib/latticeHostContext";
import { ComposerLatticeContextBar } from "./ComposerLatticeContextBar";

describe("ComposerLatticeContextBar", () => {
  it("shows a compact summary and renders every detail for disclosure", () => {
    setLiveLatticeHostContext({
      type: LATTICE_HOST_CONTEXT,
      version: 1,
      workspaceRoot: "/Users/me/paper",
      activeSurface: "editor",
      editor: {
        path: "sections/introduction.tex",
        line: 42,
        column: 7,
        selection: "Selected claim",
      },
      pdf: { page: 4, pageCount: 12 },
    });
    const markup = renderToStaticMarkup(<ComposerLatticeContextBar onClearSelection={() => {}} />);

    expect(markup).toContain("Context");
    expect(markup).toContain("introduction.tex · Line 42");
    expect(markup).toContain("Included automatically with your next message");
    expect(markup).toContain("Selected claim");
    expect(markup).toContain("Exclude selected text from context");
    expect(markup).toContain('data-testid="composer-lattice-context"');
    expect(markup.match(/data-slot="scroll-area"/g)).toHaveLength(1);
    expect(markup.match(/data-slot="scroll-area-viewport"/g)).toHaveLength(1);
    setLiveLatticeHostContext(null);
  });

  it("stays hidden when context has no selected text", () => {
    setLiveLatticeHostContext({
      type: LATTICE_HOST_CONTEXT,
      version: 1,
      workspaceRoot: "/Users/me/paper",
      activeSurface: "editor",
      editor: { path: "main.tex", line: 12, column: 4 },
      pdf: { page: 2, pageCount: 8 },
    });
    const markup = renderToStaticMarkup(<ComposerLatticeContextBar />);

    expect(markup).toBe("");
    setLiveLatticeHostContext(null);
  });

  it("makes an inspected Open Slide element visible above the composer", () => {
    setLiveLatticeHostContext({
      type: LATTICE_HOST_CONTEXT,
      version: 1,
      workspaceRoot: "/Users/me/paper",
      activeSurface: "editor",
      editor: { path: "slides/talk/index.tsx", line: 1, column: 0 },
      presentation: {
        slideId: "talk",
        pageIndex: 2,
        pageNumber: 3,
        totalPages: 8,
        slideTitle: "Research update",
        view: "slides",
        pagePath: "slides/talk/index.tsx",
        selection: { line: 42, column: 6, tagName: "h1", text: "Q2 Roadmap" },
        updatedAt: "2026-09-04T12:00:00.000Z",
      },
    });
    const markup = renderToStaticMarkup(<ComposerLatticeContextBar />);

    expect(markup).toContain("Slides · Research update · Page 3 of 8");
    expect(markup).toContain("Slide element");
    expect(markup).toContain("Q2 Roadmap");
    expect(markup).toContain('data-testid="composer-lattice-context"');
    setLiveLatticeHostContext(null);
  });
});

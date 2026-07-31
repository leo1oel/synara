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
});

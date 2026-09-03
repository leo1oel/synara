import { describe, expect, it, vi } from "vitest";

import {
  appendLatticeHostContextToPrompt,
  extractTrailingLatticeHostContext,
  getLiveLatticeHostContext,
  promptContainsLiveLatticeHostSelection,
  setLiveLatticeHostContext,
  subscribeLiveLatticeHostContext,
} from "./latticeHostContext";

const context = {
  type: "lattice:host-context" as const,
  version: 1 as const,
  workspaceRoot: "/tmp/paper",
  activeSurface: "paper" as const,
  paper: {
    title: "A Paper",
    arxivId: "2401.00001",
    path: ".research/papers/2401.00001/paper.md",
    view: "fulltext" as const,
    selection: "A useful result.",
  },
};

const presentationContext = {
  type: "lattice:host-context" as const,
  version: 1 as const,
  workspaceRoot: "/tmp/paper",
  activeSurface: "editor" as const,
  editor: { path: "slides/talk/index.tsx", line: 1, column: 0 },
  presentation: {
    slideId: "talk",
    pageIndex: 2,
    pageNumber: 3,
    totalPages: 8,
    slideTitle: "Talk",
    view: "slides" as const,
    pagePath: "slides/talk/index.tsx",
    selection: { line: 42, column: 6, tagName: "h1", text: "Q2 Roadmap" },
    updatedAt: "2026-09-04T12:00:00.000Z",
  },
};

describe("Lattice host context prompt block", () => {
  it("publishes live snapshots without coupling them to the chat view render", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLiveLatticeHostContext(listener);

    setLiveLatticeHostContext(context);

    expect(getLiveLatticeHostContext()).toBe(context);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    setLiveLatticeHostContext(null);
  });

  it("round-trips a hidden trailing context block", () => {
    const prompt = appendLatticeHostContextToPrompt("Explain this", context);
    expect(prompt).not.toMatch(/synara/i);
    expect(extractTrailingLatticeHostContext(prompt)).toEqual({
      promptText: "Explain this",
      context,
    });
  });

  it("replaces stale context instead of accumulating copies", () => {
    const first = appendLatticeHostContextToPrompt("Explain this", context);
    const second = appendLatticeHostContextToPrompt(first, {
      type: context.type,
      version: context.version,
      workspaceRoot: context.workspaceRoot,
      activeSurface: "pdf",
      pdf: { page: 4, pageCount: 10 },
    });
    expect(second.match(/<lattice_active_context/g)).toHaveLength(1);
    expect(extractTrailingLatticeHostContext(second).context?.activeSurface).toBe("pdf");
  });

  it("consumes only the selection that was actually dispatched", () => {
    const prompt = appendLatticeHostContextToPrompt("Explain this", context);

    expect(promptContainsLiveLatticeHostSelection(prompt, context)).toBe(true);
    expect(
      promptContainsLiveLatticeHostSelection(prompt, {
        ...context,
        paper: {
          ...context.paper,
          selection: "A newer selection.",
        },
      }),
    ).toBe(false);
    expect(promptContainsLiveLatticeHostSelection("Explain this", context)).toBe(false);
  });

  it("tracks an inspected Open Slide element as the dispatched selection", () => {
    const prompt = appendLatticeHostContextToPrompt("Revise this", presentationContext);

    expect(promptContainsLiveLatticeHostSelection(prompt, presentationContext)).toBe(true);
    expect(
      promptContainsLiveLatticeHostSelection(prompt, {
        ...presentationContext,
        presentation: {
          ...presentationContext.presentation,
          selection: { line: 50, column: 2, tagName: "p", text: "New selection" },
        },
      }),
    ).toBe(false);
  });
});

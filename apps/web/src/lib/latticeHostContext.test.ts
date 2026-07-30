import { describe, expect, it, vi } from "vitest";

import {
  appendLatticeHostContextToPrompt,
  extractTrailingLatticeHostContext,
  getLiveLatticeHostContext,
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
      ...context,
      activeSurface: "pdf",
      paper: undefined,
      pdf: { page: 4, pageCount: 10 },
    });
    expect(second.match(/<lattice_active_context/g)).toHaveLength(1);
    expect(extractTrailingLatticeHostContext(second).context?.activeSurface).toBe("pdf");
  });
});

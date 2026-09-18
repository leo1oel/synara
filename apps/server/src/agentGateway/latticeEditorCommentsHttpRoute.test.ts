import { describe, expect, it } from "vitest";
import { isLatticeEditorCommentsResultBody } from "./latticeEditorCommentsHttpRoute.ts";

const collection = {
  workspaceRoot: "/workspace",
  capturedAt: "2026-09-18T00:00:00Z",
  comments: [
    {
      id: "c1",
      origin: "local",
      path: "main.tex",
      from: 1,
      to: 2,
      quote: "x",
      body: "fix",
      authorName: "Ada",
      resolved: false,
      replies: [],
      updatedAt: "2026-09-18T00:00:00Z",
      anchorStatus: "exact",
    },
  ],
  omittedCount: 0,
  totalCount: 1,
  offset: 0,
  nextOffset: null,
  overleaf: { status: "fresh" },
};

describe("Lattice editor comments HTTP result validation", () => {
  it("accepts the full bounded schema for the requested workspace", () => {
    expect(
      isLatticeEditorCommentsResultBody(
        { id: "r", result: { ok: true, result: collection } },
        "/workspace",
      ),
    ).toBe(true);
    expect(
      isLatticeEditorCommentsResultBody(
        { id: "r", result: { ok: true, result: { ...collection, workspaceRoot: "/other" } } },
        "/workspace",
      ),
    ).toBe(false);
    expect(
      isLatticeEditorCommentsResultBody(
        {
          id: "r",
          result: {
            ok: true,
            result: { ...collection, comments: [{ ...collection.comments[0], resolved: "no" }] },
          },
        },
        "/workspace",
      ),
    ).toBe(false);
    expect(
      isLatticeEditorCommentsResultBody(
        { id: "r", result: { ok: false, error: { code: "x", message: "" } } },
        "/workspace",
      ),
    ).toBe(false);
  });
});

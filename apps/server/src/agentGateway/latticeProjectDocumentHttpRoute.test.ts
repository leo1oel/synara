import { describe, expect, it } from "vitest";

import { isLatticeProjectDocumentResultBody } from "./latticeProjectDocumentHttpRoute.ts";

describe("Lattice project document HTTP result validation", () => {
  it("accepts only strict, bounded native-document results", () => {
    const success = {
      id: "request-1",
      result: {
        ok: true,
        result: { path: "boards/plan.tldr", documentType: "board", opened: true },
      },
    };
    expect(isLatticeProjectDocumentResultBody(success)).toBe(true);
    expect(
      isLatticeProjectDocumentResultBody({
        ...success,
        result: {
          ok: true,
          result: {
            path: "boards/plan.lattice-sheet",
            documentType: "board",
            opened: true,
          },
        },
      }),
    ).toBe(false);
    expect(
      isLatticeProjectDocumentResultBody({
        ...success,
        result: { ...success.result, unexpected: true },
      }),
    ).toBe(false);
    expect(
      isLatticeProjectDocumentResultBody({
        id: "request-1",
        result: { ok: false, error: { code: "failed", message: "x".repeat(2_001) } },
      }),
    ).toBe(false);
  });
});

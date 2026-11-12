import { describe, expect, it } from "vitest";

import { isLatticeBibliographyResultBody } from "./latticeBibliographyHttpRoute.ts";

describe("Lattice bibliography HTTP result validation", () => {
  it("accepts only strict, bounded host results", () => {
    const success = {
      id: "request-1",
      result: {
        ok: true,
        result: { citationKey: "vaswani2017attention" },
      },
    };
    expect(isLatticeBibliographyResultBody(success)).toBe(true);
    expect(
      isLatticeBibliographyResultBody({
        ...success,
        result: { ...success.result, unexpected: true },
      }),
    ).toBe(false);
    expect(
      isLatticeBibliographyResultBody({
        ...success,
        result: { ok: true, result: ["not", "an", "object"] },
      }),
    ).toBe(false);
    expect(
      isLatticeBibliographyResultBody({
        id: "request-1",
        result: { ok: false, error: { code: "failed", message: "x".repeat(2_001) } },
      }),
    ).toBe(false);
  });
});

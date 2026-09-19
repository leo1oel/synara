import { describe, expect, it } from "vitest";
import { calculateVerticalScrollGeometry } from "./external-scrollbar-geometry";

describe("external scrollbar track clearance", () => {
  it("shortens the track without changing the native scroll range", () => {
    const viewport = { clientHeight: 600, scrollHeight: 1800, scrollTop: 600 };
    const geometry = calculateVerticalScrollGeometry(viewport, 12, 200);
    expect(geometry.top).toBe(12);
    expect(geometry.height).toBe(400);
    expect(geometry.maxScrollTop).toBe(1200);
    expect(geometry.thumbHeight).toBeCloseTo(392 / 3);
    expect(geometry.thumbOffset).toBeCloseTo((392 - 392 / 3) / 2);
    const end = calculateVerticalScrollGeometry({ ...viewport, scrollTop: 1200 }, 12, 200);
    expect(end.thumbOffset + end.thumbHeight).toBeCloseTo(392);
  });

  it("preserves a full-height track without an overlay and bounds oversized overlays", () => {
    const viewport = { clientHeight: 600, scrollHeight: 1800, scrollTop: 1200 };
    expect(calculateVerticalScrollGeometry(viewport).height).toBe(600);
    const covered = calculateVerticalScrollGeometry(viewport, 0, 800);
    expect(covered.height).toBe(0);
    expect(covered.overflow).toBe(false);
    expect(covered.maxScrollTop).toBe(1200);
  });
});

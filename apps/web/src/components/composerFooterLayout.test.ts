import { describe, expect, it } from "vitest";

import {
  COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX,
  COMPOSER_FOOTER_MAX_TIER,
  COMPOSER_FOOTER_SURFACE_EDGE_GUARD_PX,
  COMPOSER_FOOTER_TIER_PROMOTION_SLACK_PX,
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
  EMBED_COMPOSER_SEND_EDGE_INSET_PX,
  composerFooterActionsClip,
  composerFooterActionsCrossSurfaceEdge,
  composerFooterIsOverflowing,
  composerFooterPlanForTier,
  embedComposerMinimumSidebarWidth,
  embedHorizontalContentMinimumSidebarWidth,
  resolveNextComposerFooterTier,
  shouldUseCompactComposerFooter,
} from "./composerFooterLayout";

describe("shouldUseCompactComposerFooter", () => {
  it("stays expanded without a measured width", () => {
    expect(shouldUseCompactComposerFooter(null)).toBe(false);
  });

  it("switches to compact mode below the breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX - 1)).toBe(true);
  });

  it("stays expanded at and above the breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX)).toBe(false);
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX + 48)).toBe(false);
  });

  it("uses a higher breakpoint for wide action states", () => {
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX - 1, {
        hasWideActions: true,
      }),
    ).toBe(true);
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasWideActions: true,
      }),
    ).toBe(false);
  });
});

describe("composerFooterPlanForTier", () => {
  it("maps tiers to the degradation order: meter, traits label, model label, relocation", () => {
    expect(composerFooterPlanForTier(0, true)).toEqual({
      showContextMeter: true,
      showTraitsLabel: true,
      showModelLabel: true,
      relocateLeadingControls: false,
    });
    expect(composerFooterPlanForTier(1, true)).toEqual({
      showContextMeter: false,
      showTraitsLabel: true,
      showModelLabel: true,
      relocateLeadingControls: false,
    });
    expect(composerFooterPlanForTier(2, true)).toEqual({
      showContextMeter: false,
      showTraitsLabel: false,
      showModelLabel: true,
      relocateLeadingControls: false,
    });
    expect(composerFooterPlanForTier(3, true)).toEqual({
      showContextMeter: false,
      showTraitsLabel: false,
      showModelLabel: false,
      relocateLeadingControls: false,
    });
    expect(composerFooterPlanForTier(COMPOSER_FOOTER_MAX_TIER, true)).toEqual({
      showContextMeter: false,
      showTraitsLabel: false,
      showModelLabel: false,
      relocateLeadingControls: true,
    });
  });

  it("never shows the context meter when the thread has none", () => {
    expect(composerFooterPlanForTier(0, false).showContextMeter).toBe(false);
  });
});

describe("composerFooterActionsCrossSurfaceEdge", () => {
  it("does not treat the footer's normal end padding as overflow", () => {
    expect(
      composerFooterActionsCrossSurfaceEdge({
        actionsRight: 492.5,
        surfaceRight: 500,
      }),
    ).toBe(false);
  });

  it("guards controls that touch or cross the composer edge", () => {
    expect(
      composerFooterActionsCrossSurfaceEdge({
        actionsRight: 500 - COMPOSER_FOOTER_SURFACE_EDGE_GUARD_PX / 2,
        surfaceRight: 500,
      }),
    ).toBe(true);
    expect(
      composerFooterActionsCrossSurfaceEdge({
        actionsRight: 501,
        surfaceRight: 500,
      }),
    ).toBe(true);
  });
});

describe("composerFooterActionsClip", () => {
  it("ignores descendant scroll width in the embedded max-content track", () => {
    expect(
      composerFooterActionsClip({
        isEmbed: true,
        intrinsicWidth: 240,
        clientWidth: 120,
      }),
    ).toBe(false);
  });

  it("still detects clipped flexible action rows outside embed mode", () => {
    expect(
      composerFooterActionsClip({
        isEmbed: false,
        intrinsicWidth: 240,
        clientWidth: 120,
      }),
    ).toBe(true);
  });
});

describe("composerFooterIsOverflowing", () => {
  it("uses the embedded grid row as the single source of truth", () => {
    expect(
      composerFooterIsOverflowing({
        isEmbed: true,
        rowOverflows: false,
        leadingClips: true,
        actionsClip: true,
        actionsCrossSurfaceEdge: true,
      }),
    ).toBe(false);
    expect(
      composerFooterIsOverflowing({
        isEmbed: true,
        rowOverflows: true,
        leadingClips: false,
        actionsClip: false,
        actionsCrossSurfaceEdge: false,
      }),
    ).toBe(true);
  });

  it("retains every overflow guard in the standalone layout", () => {
    for (const overflowKey of [
      "rowOverflows",
      "leadingClips",
      "actionsClip",
      "actionsCrossSurfaceEdge",
    ] as const) {
      expect(
        composerFooterIsOverflowing({
          isEmbed: false,
          rowOverflows: overflowKey === "rowOverflows",
          leadingClips: overflowKey === "leadingClips",
          actionsClip: overflowKey === "actionsClip",
          actionsCrossSurfaceEdge: overflowKey === "actionsCrossSurfaceEdge",
        }),
      ).toBe(true);
    }
  });
});

describe("embedComposerMinimumSidebarWidth", () => {
  it("includes every intrinsic control and preserves the send-edge inset", () => {
    expect(
      embedComposerMinimumSidebarWidth({
        viewportWidth: 360,
        footerWidth: 336,
        footerPaddingLeft: 6,
        footerPaddingRight: 4,
        footerGap: 2,
        leadingIntrinsicWidth: 24,
        actionsIntrinsicWidth: 246,
      }),
    ).toBe(310);
  });

  it("grows and shrinks with the active model, effort, and speed controls", () => {
    const base = {
      viewportWidth: 360,
      footerWidth: 336,
      footerPaddingLeft: 6,
      footerPaddingRight: EMBED_COMPOSER_SEND_EDGE_INSET_PX,
      footerGap: 2,
      leadingIntrinsicWidth: 24,
    };
    const regular = embedComposerMinimumSidebarWidth({
      ...base,
      actionsIntrinsicWidth: 180,
    });
    const fastHighEffort = embedComposerMinimumSidebarWidth({
      ...base,
      actionsIntrinsicWidth: 232,
    });

    expect(fastHighEffort - regular).toBe(52);
  });
});

describe("embedHorizontalContentMinimumSidebarWidth", () => {
  it("includes the surface gutters, content width, and trailing inset", () => {
    expect(
      embedHorizontalContentMinimumSidebarWidth({
        viewportWidth: 320,
        surfaceWidth: 296,
        contentRightOffset: 262,
        endInset: 8,
      }),
    ).toBe(294);
  });

  it("ignores invalid negative geometry", () => {
    expect(
      embedHorizontalContentMinimumSidebarWidth({
        viewportWidth: 280,
        surfaceWidth: 300,
        contentRightOffset: -20,
        endInset: -4,
      }),
    ).toBe(0);
  });
});

describe("resolveNextComposerFooterTier", () => {
  it("keeps the tier when the footer fits", () => {
    expect(
      resolveNextComposerFooterTier({
        currentTier: 0,
        clientWidth: 500,
        isOverflowing: false,
        demotionWidths: [],
      }),
    ).toEqual({ tier: 0, demotionWidths: [] });
  });

  it("demotes one step and records the overflow width", () => {
    const step = resolveNextComposerFooterTier({
      currentTier: 0,
      clientWidth: 400,
      isOverflowing: true,
      demotionWidths: [],
    });
    expect(step.tier).toBe(1);
    expect(step.demotionWidths[0]).toBe(400);
  });

  it("keeps demoting on repeated overflow until the max tier", () => {
    let demotionWidths: ReadonlyArray<number | undefined> = [];
    let tier = 0;
    for (let pass = 0; pass < 6; pass += 1) {
      const step = resolveNextComposerFooterTier({
        currentTier: tier,
        clientWidth: 300,
        isOverflowing: true,
        demotionWidths,
      });
      tier = step.tier;
      demotionWidths = step.demotionWidths;
    }
    expect(tier).toBe(COMPOSER_FOOTER_MAX_TIER);
  });

  it("promotes back only after clearing the recorded width plus slack", () => {
    const demotionWidths = [400];
    const tooNarrow = resolveNextComposerFooterTier({
      currentTier: 1,
      clientWidth: 400 + COMPOSER_FOOTER_TIER_PROMOTION_SLACK_PX - 1,
      isOverflowing: false,
      demotionWidths,
    });
    expect(tooNarrow.tier).toBe(1);
    const wideEnough = resolveNextComposerFooterTier({
      currentTier: 1,
      clientWidth: 400 + COMPOSER_FOOTER_TIER_PROMOTION_SLACK_PX,
      isOverflowing: false,
      demotionWidths,
    });
    expect(wideEnough.tier).toBe(0);
  });

  it("promotes multiple steps at once when width allows", () => {
    const step = resolveNextComposerFooterTier({
      currentTier: COMPOSER_FOOTER_MAX_TIER,
      clientWidth: 900,
      isOverflowing: false,
      demotionWidths: [400, 360, 320, 300],
    });
    expect(step.tier).toBe(0);
  });
});

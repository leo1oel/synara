import { describe, expect, it, vi } from "vitest";

import {
  createEmbeddedSettingsHeightReporter,
  measureEmbeddedSettingsHeight,
} from "./embeddedSettingsHeight";

describe("embedded settings height", () => {
  it("measures overflowing content instead of only its border box", () => {
    expect(
      measureEmbeddedSettingsHeight({
        offsetHeight: 700,
        scrollHeight: 912.2,
      }),
    ).toBe(913);
  });

  it("keeps the embedded settings minimum height", () => {
    expect(
      measureEmbeddedSettingsHeight({
        offsetHeight: 120,
        scrollHeight: 120,
      }),
    ).toBe(470);
  });

  it("publishes a later scroll-height-only change when scheduled by a mutation", () => {
    let height = 700;
    let queuedFrame: FrameRequestCallback | null = null;
    const publish = vi.fn();
    const reporter = createEmbeddedSettingsHeightReporter({
      measure: () => height,
      publish,
      requestFrame: (callback) => {
        queuedFrame = callback;
        return 1;
      },
      cancelFrame: vi.fn(),
    });

    reporter.flush();
    expect(publish).toHaveBeenLastCalledWith(700);

    height = 940;
    reporter.schedule();
    expect(queuedFrame).not.toBeNull();
    (queuedFrame as unknown as FrameRequestCallback)(0);

    expect(publish).toHaveBeenLastCalledWith(940);
  });

  it("deduplicates unchanged measurements", () => {
    const publish = vi.fn();
    const reporter = createEmbeddedSettingsHeightReporter({
      measure: () => 700,
      publish,
      requestFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
    });

    expect(reporter.flush()).toBe(700);
    expect(reporter.flush()).toBe(700);

    expect(publish).toHaveBeenCalledTimes(1);
  });
});

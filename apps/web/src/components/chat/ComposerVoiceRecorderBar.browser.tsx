// FILE: ComposerVoiceRecorderBar.browser.tsx
// Purpose: Verifies voice recording actions and responsive waveform layout.
// Layer: Browser UI test
// Depends on: vitest browser rendering and ComposerVoiceRecorderBar.

import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ComposerVoiceRecorderBar } from "./ComposerVoiceRecorderBar";

describe("ComposerVoiceRecorderBar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses the send treatment for stop while keeping cancel separate", async () => {
    const onDiscard = vi.fn();
    const onStop = vi.fn();
    const screen = await render(
      <ComposerVoiceRecorderBar
        durationLabel="0:03"
        isRecording
        isTranscribing={false}
        waveformLevels={[0.2, 0.6, 0.4]}
        onDiscard={onDiscard}
        onStop={onStop}
      />,
    );

    const stopButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Stop voice recording"]',
    );
    expect(stopButton).not.toBeNull();
    expect(stopButton?.className).toContain("bg-[var(--color-text-foreground)]");
    expect(stopButton?.className).toContain("text-[var(--color-background-surface)]");
    expect(document.querySelector('button[aria-label="Send voice note"]')).toBeNull();

    await page.getByRole("button", { name: "Stop voice recording" }).click();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "Cancel voice recording" }).click();
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);

    await screen.unmount();
  });

  it("fills the flexible portion of an embedded composer footer", async () => {
    const screen = await render(
      <div
        data-testid="footer"
        className="grid w-[430px] grid-cols-[auto_minmax(0,1fr)] gap-1"
      >
        <div data-testid="leading" className="w-8" />
        <div className="flex min-w-0">
          <ComposerVoiceRecorderBar
            durationLabel="0:02"
            isRecording
            isTranscribing={false}
            waveformLevels={[]}
            onDiscard={() => undefined}
            onStop={() => undefined}
          />
        </div>
      </div>,
    );

    const footer = screen.getByTestId("footer").element();
    const leading = screen.getByTestId("leading").element();
    const waveform = document.querySelector<HTMLElement>("[data-voice-waveform-track='true']");
    expect(waveform).not.toBeNull();
    expect(waveform!.clientWidth).toBeGreaterThan(
      (footer.clientWidth - leading.clientWidth) / 2,
    );

    await screen.unmount();
  });
});

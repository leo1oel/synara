// FILE: voiceRecorder.browser.tsx
// Purpose: Verifies microphone startup cancellation and waveform scaling in a real browser.
// Layer: Web browser test
// Depends on: vitest browser hooks and mocked browser media/Web Audio primitives.

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";

import { isVoiceRecordingCancelledError, useVoiceRecorder } from "./voiceRecorder";

describe("useVoiceRecorder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not activate recording after cancellation during AudioContext resume", async () => {
    let resolveResume!: () => void;
    const resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveResume = resolve;
        }),
    );
    const close = vi.fn(async () => undefined);

    class DeferredAudioContext {
      readonly resume = resume;
      readonly close = close;
    }

    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream;
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(stream);
    vi.stubGlobal("AudioContext", DeferredAudioContext);

    const hook = await renderHook(() => useVoiceRecorder());
    const starting = hook.result.current.startRecording();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));

    await hook.result.current.cancelRecording();
    resolveResume();

    await expect(starting).rejects.toSatisfy(isVoiceRecordingCancelledError);
    expect(hook.result.current.isRecording).toBe(false);
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);

    await hook.unmount();
  });

  it("keeps quiet microphone speech visibly above the waveform floor", async () => {
    let processorNode: {
      onaudioprocess: ((event: AudioProcessingEvent) => void) | null;
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    } | null = null;
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    const stream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(stream);

    class TestAudioContext {
      readonly sampleRate = 24_000;
      readonly destination = {} as AudioDestinationNode;

      readonly resume = vi.fn(async () => undefined);
      readonly close = vi.fn(async () => undefined);

      createMediaStreamSource() {
        return {
          connect: vi.fn(),
          disconnect: vi.fn(),
        } as unknown as MediaStreamAudioSourceNode;
      }

      createScriptProcessor() {
        processorNode = {
          onaudioprocess: null,
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
        return processorNode as unknown as ScriptProcessorNode;
      }

      createGain() {
        return {
          gain: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn(),
        } as unknown as GainNode;
      }
    }
    vi.stubGlobal("AudioContext", TestAudioContext);

    const hook = await renderHook(() => useVoiceRecorder());
    await hook.result.current.startRecording();
    await vi.waitFor(() => expect(hook.result.current.isRecording).toBe(true));

    const emitLevel = (amplitude: number) => {
      now += 60;
      const samples = new Float32Array(32).fill(amplitude);
      processorNode?.onaudioprocess?.({
        inputBuffer: {
          numberOfChannels: 1,
          length: samples.length,
          getChannelData: () => samples,
        },
      } as AudioProcessingEvent);
    };

    emitLevel(0.004);
    emitLevel(0.008);

    await vi.waitFor(() => {
      const [quietLevel, louderLevel] = hook.result.current.waveformLevels;
      expect(quietLevel).toBeGreaterThan(0.04);
      expect(louderLevel).toBeGreaterThan((quietLevel ?? 0) + 0.05);
    });

    await hook.unmount();
  });
});

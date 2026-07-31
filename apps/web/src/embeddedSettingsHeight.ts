export const MIN_EMBEDDED_SETTINGS_HEIGHT = 470;

type SettingsHeightSource = Pick<HTMLElement, "offsetHeight" | "scrollHeight">;

export function measureEmbeddedSettingsHeight(content: SettingsHeightSource): number {
  return Math.ceil(Math.max(MIN_EMBEDDED_SETTINGS_HEIGHT, content.offsetHeight, content.scrollHeight));
}

export function createEmbeddedSettingsHeightReporter(options: {
  measure: () => number;
  publish: (height: number) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}) {
  const requestFrame = options.requestFrame ?? ((callback) => window.requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle));
  let frame: number | null = null;
  let lastReportedHeight = 0;
  let disposed = false;

  const flush = () => {
    if (disposed) return null;
    if (frame !== null) {
      cancelFrame(frame);
      frame = null;
    }
    const height = options.measure();
    if (height !== lastReportedHeight) {
      lastReportedHeight = height;
      options.publish(height);
    }
    return height;
  };

  const schedule = () => {
    if (disposed || frame !== null) return;
    frame = requestFrame(() => {
      frame = null;
      flush();
    });
  };

  const dispose = () => {
    disposed = true;
    if (frame !== null) {
      cancelFrame(frame);
      frame = null;
    }
  };

  return { dispose, flush, schedule };
}

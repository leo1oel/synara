import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import type { EmbedModeConfig } from "../embedMode";
import { useEmbedReadySignal } from "./useEmbedReadySignal";

const config: EmbedModeConfig = {
  workspaceRoot: "/fixture/repo",
  theme: "light",
  surface: "drawer",
  locale: "en",
  hostOrigin: window.location.origin,
};

function Surface({ embedMode }: { embedMode: EmbedModeConfig | null }) {
  useEmbedReadySignal(embedMode);
  return <div>Loading surface</div>;
}

describe("useEmbedReadySignal", () => {
  it("posts the existing ready contract after the surface commits, once per mount", async () => {
    const postMessage = vi.spyOn(window.parent, "postMessage");
    try {
      const surface = await render(<Surface embedMode={config} />);
      expect(postMessage).toHaveBeenCalledExactlyOnceWith(
        { type: "synara:embed-ready" },
        config.hostOrigin,
      );
      await surface.rerender(<Surface embedMode={config} />);
      expect(postMessage).toHaveBeenCalledTimes(1);
    } finally {
      postMessage.mockRestore();
    }
  });

  it("does not signal outside embed mode or without a trusted host origin", async () => {
    const postMessage = vi.spyOn(window.parent, "postMessage");
    try {
      const surface = await render(<Surface embedMode={null} />);
      expect(postMessage).not.toHaveBeenCalled();
      await surface.rerender(<Surface embedMode={{ ...config, hostOrigin: null }} />);
      expect(postMessage).not.toHaveBeenCalled();
    } finally {
      postMessage.mockRestore();
    }
  });
});

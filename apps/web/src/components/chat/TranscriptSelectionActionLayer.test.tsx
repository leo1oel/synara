import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TranscriptSelectionActionLayer } from "./TranscriptSelectionActionLayer";

const action = {
  selection: {
    assistantMessageId: "assistant-message-1",
    text: "Selected assistant text",
  },
  left: 24,
  top: 48,
  placement: "top" as const,
};

function renderLayer(showMarkerActions: boolean): string {
  return renderToStaticMarkup(
    <TranscriptSelectionActionLayer
      action={action}
      showMarkerActions={showMarkerActions}
      onHighlight={vi.fn()}
      onUnderline={vi.fn()}
      onAddToChat={vi.fn()}
    />,
  );
}

describe("TranscriptSelectionActionLayer", () => {
  it("only offers Add to chat when marker actions are hidden", () => {
    const markup = renderLayer(false);

    expect(markup).toContain("Add to chat");
    expect(markup).not.toContain("Highlight");
    expect(markup).not.toContain("Underline");
  });

  it("keeps marker actions available outside the embedded panel", () => {
    const markup = renderLayer(true);

    expect(markup).toContain("Add to chat");
    expect(markup).toContain("Highlight");
    expect(markup).toContain("Underline");
  });
});

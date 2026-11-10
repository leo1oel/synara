// FILE: external-scrollbar.browser.tsx
// Purpose: Guards how the overlay scrollbar finds its scroll owner: event-driven, never by
//          polling every frame, which kept the hidden Agent iframe awake for the app lifetime.
// Layer: Browser UI test

import "../../index.css";

import { useCallback, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ExternalScrollbar } from "./external-scrollbar";

let showList: (visible: boolean) => void = () => {};

// Mirrors ChatTranscriptPane: the overlay is a sibling of the timeline inside one surface, and
// the timeline renders either an empty state or the scroll container.
function TranscriptSurface({ initialList }: { initialList: boolean }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [listVisible, setListVisible] = useState(initialList);
  showList = setListVisible;
  const getViewport = useCallback(
    () =>
      surfaceRef.current?.querySelector<HTMLElement>('[data-chat-scroll-container="true"]') ?? null,
    [],
  );
  return (
    <div
      ref={surfaceRef}
      className="relative flex flex-col overflow-hidden"
      style={{ height: 300, width: 400 }}
    >
      <div className="contents">
        {listVisible ? (
          <div data-chat-scroll-container="true" style={{ height: 300, overflowY: "auto" }}>
            <div style={{ height: 3000 }}>rows</div>
          </div>
        ) : (
          // A different element type, like MessagesTimeline's empty state, so React replaces
          // the scroll container instead of reusing it.
          <p data-testid="empty-state">Send a message to start</p>
        )}
      </div>
      <ExternalScrollbar getViewport={getViewport} />
    </div>
  );
}

function track(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".external-scrollbar");
  if (!element) throw new Error("overlay track is not mounted");
  return element;
}

function viewport(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-chat-scroll-container="true"]');
  if (!element) throw new Error("scroll container is not mounted");
  return element;
}

async function nextFrames(count: number) {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
}

// Counts frames requested by anything other than the test's own frame waits.
async function countFramesRequestedOver(frames: number) {
  const nativeRequest = window.requestAnimationFrame.bind(window);
  let requested = 0;
  const spy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    requested += 1;
    return nativeRequest(callback);
  });
  try {
    for (let index = 0; index < frames; index += 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
    }
  } finally {
    spy.mockRestore();
  }
  return requested;
}

describe("ExternalScrollbar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("schedules no frames on an empty thread once mount settles", async () => {
    const mounted = await render(<TranscriptSurface initialList={false} />);
    await expect.element(mounted.getByTestId("empty-state")).toBeVisible();
    await nextFrames(3);

    expect(await countFramesRequestedOver(10)).toBe(0);
    expect(track().style.height).toBe("0px");
    await mounted.unmount();
  });

  it("attaches when the scroll container mounts later, and re-arms when it is replaced", async () => {
    const mounted = await render(<TranscriptSurface initialList={false} />);
    await nextFrames(3);

    // New chat -> first message: the list appears after the overlay mounted.
    showList(true);
    await vi.waitFor(() => {
      expect(track().style.height).toBe("300px");
      expect(track().hasAttribute("data-overflow-y-end")).toBe(true);
    });

    // Attached behavior is unchanged: scrolling the owner drives the overlay.
    viewport().scrollTop = 1200;
    await vi.waitFor(() => {
      expect(track().hasAttribute("data-scrolling")).toBe(true);
      expect(track().hasAttribute("data-overflow-y-start")).toBe(true);
    });

    // The thread empties: the overlay drops the stale owner and goes quiet again.
    showList(false);
    await vi.waitFor(() => {
      expect(track().style.height).toBe("0px");
    });
    await nextFrames(3);
    expect(await countFramesRequestedOver(10)).toBe(0);

    // And attaches to the replacement list.
    showList(true);
    await vi.waitFor(() => {
      expect(track().style.height).toBe("300px");
      expect(track().hasAttribute("data-overflow-y-end")).toBe(true);
    });
    await mounted.unmount();
  });

  it("attaches immediately when the scroll container already exists", async () => {
    const mounted = await render(<TranscriptSurface initialList />);
    await vi.waitFor(() => {
      expect(track().style.height).toBe("300px");
      expect(track().hasAttribute("data-overflow-y-end")).toBe(true);
    });

    // An element that stops being the scroll owner while staying in the DOM is dropped too.
    viewport().removeAttribute("data-chat-scroll-container");
    await vi.waitFor(() => {
      expect(track().style.height).toBe("0px");
    });
    await mounted.unmount();
  });
});

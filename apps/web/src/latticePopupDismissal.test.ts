import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LATTICE_OUTSIDE_POINTER_DOWN, SYNARA_POPUP_OPEN, type EmbedModeConfig } from "./embedMode";

const HOST_ORIGIN = "http://localhost:1420";
const embed = vi.hoisted(() => ({ config: null as EmbedModeConfig | null }));

vi.mock("./embedMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./embedMode")>()),
  readEmbedMode: () => embed.config,
}));

class TestMouseEvent extends Event {}

function installFrame() {
  const listeners = new Map<string, (event: unknown) => void>();
  const postMessage = vi.fn();
  const parent = { postMessage };
  const frame = {
    parent,
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const dispatched: string[] = [];
  const root = {
    ownerDocument: { defaultView: frame },
    dispatchEvent: (event: Event) => {
      dispatched.push(event.type);
      return true;
    },
  };
  vi.stubGlobal("window", frame);
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("MouseEvent", TestMouseEvent);
  vi.stubGlobal("PointerEvent", TestMouseEvent);
  const hostMessage = (event: Partial<MessageEvent>) => listeners.get("message")?.(event);
  return { parent, postMessage, dispatched, listeners, hostMessage };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function loadModule() {
  vi.resetModules();
  return import("./latticePopupDismissal");
}

beforeEach(() => {
  embed.config = {
    workspaceRoot: "/Users/me/paper",
    theme: "light",
    surface: "chrome",
    hostOrigin: HOST_ORIGIN,
    locale: "en",
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Lattice popup dismissal", () => {
  it("tells Lattice when the first popup opens and after the last one closes", async () => {
    const { postMessage } = installFrame();
    const { trackOpenPopup } = await loadModule();

    const releaseMenu = trackOpenPopup();
    const releaseSelect = trackOpenPopup();
    releaseMenu();
    expect(postMessage.mock.calls).toEqual([
      [{ type: SYNARA_POPUP_OPEN, open: true }, HOST_ORIGIN],
    ]);

    releaseSelect();
    releaseSelect();
    expect(postMessage.mock.calls).toEqual([
      [{ type: SYNARA_POPUP_OPEN, open: true }, HOST_ORIGIN],
      [{ type: SYNARA_POPUP_OPEN, open: false }, HOST_ORIGIN],
    ]);
  });

  it("replays a press Lattice reports as a press outside every open popup", async () => {
    const { parent, dispatched, hostMessage } = installFrame();
    const { startLatticePopupDismissal, trackOpenPopup } = await loadModule();
    startLatticePopupDismissal();
    const dismissOverlayMenu = vi.fn();
    trackOpenPopup(dismissOverlayMenu);

    // Only the configured host, as this frame's parent, is heard.
    hostMessage({
      source: parent as never,
      origin: "https://evil.example",
      data: { type: LATTICE_OUTSIDE_POINTER_DOWN },
    });
    hostMessage({
      source: {} as never,
      origin: HOST_ORIGIN,
      data: { type: LATTICE_OUTSIDE_POINTER_DOWN },
    });
    hostMessage({
      source: parent as never,
      origin: HOST_ORIGIN,
      data: { type: "lattice:host-pointer" },
    });
    await settle();
    expect(dispatched).toEqual([]);
    expect(dismissOverlayMenu).not.toHaveBeenCalled();

    hostMessage({
      source: parent as never,
      origin: HOST_ORIGIN,
      data: { type: LATTICE_OUTSIDE_POINTER_DOWN },
    });
    await settle();
    expect(dispatched).toEqual(["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
    expect(dismissOverlayMenu).toHaveBeenCalledOnce();
  });

  it("reports a popup still open after Lattice spent its flag on a press", async () => {
    const { parent, postMessage, hostMessage } = installFrame();
    const { startLatticePopupDismissal, trackOpenPopup } = await loadModule();
    startLatticePopupDismissal();
    const releaseClosing = trackOpenPopup();

    hostMessage({
      source: parent as never,
      origin: HOST_ORIGIN,
      data: { type: LATTICE_OUTSIDE_POINTER_DOWN },
    });
    // A new popup opens while the dismissed one is still animating out.
    trackOpenPopup();
    releaseClosing();
    expect(postMessage.mock.calls).toEqual([
      [{ type: SYNARA_POPUP_OPEN, open: true }, HOST_ORIGIN],
      [{ type: SYNARA_POPUP_OPEN, open: true }, HOST_ORIGIN],
    ]);
  });

  it("dismisses on window blur, and replays nothing with no popup open", async () => {
    const { dispatched, listeners } = installFrame();
    const { startLatticePopupDismissal, trackOpenPopup } = await loadModule();
    startLatticePopupDismissal();

    listeners.get("blur")?.(new Event("blur"));
    await settle();
    expect(dispatched).toEqual([]);

    trackOpenPopup();
    listeners.get("blur")?.(new Event("blur"));
    await settle();
    expect(dispatched).toEqual(["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  });

  it("stays out of the way outside Lattice", async () => {
    embed.config = null;
    const { postMessage, listeners } = installFrame();
    const { startLatticePopupDismissal, trackOpenPopup } = await loadModule();
    startLatticePopupDismissal();
    trackOpenPopup()();
    expect(listeners.size).toBe(0);
    expect(postMessage).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LATTICE_HOST_SHORTCUTS,
  LATTICE_HOST_SHORTCUTS_REQUEST,
  SYNARA_HOST_SHORTCUT,
  type EmbedModeConfig,
} from "./embedMode";

const HOST_ORIGIN = "http://localhost:1420";
const embed = vi.hoisted(() => ({ config: null as EmbedModeConfig | null }));

vi.mock("./embedMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./embedMode")>()),
  readEmbedMode: () => embed.config,
}));

/** Lattice's ⌘P (quick open), ⌘1 (first workspace), ⌘⌥1 (Project panel), ⌘? and ⌃` (terminal). */
const HOST_SHORTCUTS = [
  { key: "p", mod: true, ctrl: false, shift: false, alt: false },
  { key: "1", mod: true, ctrl: false, shift: false, alt: false },
  { key: "1", mod: true, ctrl: false, shift: false, alt: true },
  { key: "?", mod: true, ctrl: false, shift: true, alt: false },
  { key: "`", mod: false, ctrl: true, shift: false, alt: false },
];

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
  vi.stubGlobal("window", frame);
  const hostMessage = (event: Partial<MessageEvent>) => listeners.get("message")?.(event);
  const press = (init: Partial<KeyboardEvent>) => {
    const event = {
      key: "",
      code: "",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      ...init,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    listeners.get("keydown")?.(event);
    return event;
  };
  return { parent, postMessage, listeners, hostMessage, press };
}

async function loadModule() {
  vi.resetModules();
  return import("./latticeHostShortcuts");
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

describe("Lattice host shortcuts", () => {
  it("asks Lattice for its keys and stops nothing until it answers", async () => {
    const { postMessage, press } = installFrame();
    const { startLatticeHostShortcuts } = await loadModule();
    startLatticeHostShortcuts();

    expect(postMessage.mock.calls).toEqual([
      [{ type: LATTICE_HOST_SHORTCUTS_REQUEST, version: 1 }, HOST_ORIGIN],
    ]);
    const quickOpen = press({ key: "p", code: "KeyP", metaKey: true });
    expect(quickOpen.preventDefault).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("leaves Lattice's keys to Lattice and keeps the rest", async () => {
    const { parent, postMessage, hostMessage, press } = installFrame();
    const { startLatticeHostShortcuts } = await loadModule();
    startLatticeHostShortcuts();
    postMessage.mockClear();
    hostMessage({
      source: parent as never,
      origin: HOST_ORIGIN,
      data: { type: LATTICE_HOST_SHORTCUTS, version: 1, shortcuts: HOST_SHORTCUTS },
    });

    // ⌘P is Lattice's quick open here, never this app's file search.
    const quickOpen = press({ key: "p", code: "KeyP", metaKey: true });
    expect(quickOpen.preventDefault).toHaveBeenCalledOnce();
    expect(quickOpen.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls).toEqual([
      [
        {
          type: SYNARA_HOST_SHORTCUT,
          version: 1,
          key: "p",
          code: "KeyP",
          metaKey: true,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
        },
        HOST_ORIGIN,
      ],
    ]);

    // ⌥1 types ¡; the key's position says it is ⌘⌥1.
    expect(
      press({ key: "¡", code: "Digit1", metaKey: true, altKey: true }).preventDefault,
    ).toHaveBeenCalledOnce();
    expect(
      press({ key: "/", code: "Slash", metaKey: true, shiftKey: true }).preventDefault,
    ).toHaveBeenCalledOnce();
    expect(
      press({ key: "`", code: "Backquote", ctrlKey: true }).preventDefault,
    ).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledTimes(4);

    // Keys Lattice does not keep, and text an IME is composing, stay here.
    for (const init of [
      { key: "f", code: "KeyF", metaKey: true },
      { key: "p", code: "KeyP", metaKey: true, shiftKey: true },
      { key: "p", code: "KeyP" },
      { key: "`", code: "Backquote", metaKey: true },
      { key: "p", code: "KeyP", metaKey: true, isComposing: true },
    ]) {
      const event = press(init);
      expect(event.preventDefault, JSON.stringify(init)).not.toHaveBeenCalled();
      expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    }
    expect(postMessage).toHaveBeenCalledTimes(4);
  });

  it("hears only its own Lattice host, and a later list replaces the earlier", async () => {
    const { parent, hostMessage, press } = installFrame();
    const { startLatticeHostShortcuts } = await loadModule();
    startLatticeHostShortcuts();
    const list = { type: LATTICE_HOST_SHORTCUTS, version: 1, shortcuts: HOST_SHORTCUTS };
    hostMessage({ source: parent as never, origin: "https://evil.example", data: list });
    hostMessage({ source: {} as never, origin: HOST_ORIGIN, data: list });
    hostMessage({ source: parent as never, origin: HOST_ORIGIN, data: { ...list, version: 2 } });
    expect(press({ key: "p", code: "KeyP", metaKey: true }).preventDefault).not.toHaveBeenCalled();

    hostMessage({ source: parent as never, origin: HOST_ORIGIN, data: list });
    expect(press({ key: "p", code: "KeyP", metaKey: true }).preventDefault).toHaveBeenCalledOnce();
    // Lattice no longer runs ⌘P (no project open): it is this app's again.
    hostMessage({ source: parent as never, origin: HOST_ORIGIN, data: { ...list, shortcuts: [] } });
    expect(press({ key: "p", code: "KeyP", metaKey: true }).preventDefault).not.toHaveBeenCalled();
  });

  it("drops malformed shortcuts and does nothing outside a Lattice embed", async () => {
    const { parseLatticeHostShortcuts, startLatticeHostShortcuts } = await loadModule();
    expect(
      parseLatticeHostShortcuts({
        type: LATTICE_HOST_SHORTCUTS,
        version: 1,
        shortcuts: [HOST_SHORTCUTS[0], { key: "k", mod: "yes" }, { key: "", mod: true }, null],
      }),
    ).toEqual([HOST_SHORTCUTS[0]]);
    expect(parseLatticeHostShortcuts({ type: LATTICE_HOST_SHORTCUTS, version: 1 })).toBeNull();

    embed.config = null;
    const { listeners, postMessage } = installFrame();
    startLatticeHostShortcuts();
    expect(listeners.size).toBe(0);
    expect(postMessage).not.toHaveBeenCalled();
  });
});

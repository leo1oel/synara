import {
  LATTICE_HOST_SHORTCUTS,
  LATTICE_HOST_SHORTCUTS_REQUEST,
  SYNARA_HOST_SHORTCUT,
  readEmbedMode,
} from "./embedMode";

/**
 * Lattice embeds this app in a cross-origin iframe, and a key pressed here
 * never reaches its window: with the Agent panel or a Git view focused,
 * Lattice's ⌘K, ⌘S and ⌘, did nothing, and this app ran its own ⌘P (search
 * files), ⌘N (new chat) and ⌘1 (a thread) where the writer meant Lattice's
 * quick open and first workspace.
 *
 * Lattice says which keys its window can run now (`lattice:host-shortcuts`,
 * answering `lattice:request-host-shortcuts` and again whenever the set
 * changes). Such a key is stopped here before any listener of this app sees
 * it, and posted to Lattice (`synara:host-shortcut`), which runs it as if it
 * had been pressed beside the frame. Every other key stays with this app.
 */

/** One key Lattice keeps, in its command table's terms (Lattice's `src/app/use-app-commands.ts`). */
export interface LatticeHostShortcut {
  /** `KeyboardEvent.key`, lower-cased: "p", "?", "f8". */
  key: string;
  /** ⌘ on a Mac, Ctrl elsewhere. */
  mod: boolean;
  /** ⌃ itself, never ⌘. */
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

type KeyPress = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

/** More shortcuts than any command table holds: a bound on what one message may carry. */
const MAX_SHORTCUTS = 256;
const MAX_KEY_LENGTH = 32;

function parseShortcut(value: unknown): LatticeHostShortcut | null {
  if (!value || typeof value !== "object") return null;
  const { key, mod, ctrl, shift, alt } = value as Record<string, unknown>;
  if (typeof key !== "string" || !key || key.length > MAX_KEY_LENGTH) return null;
  if (![mod, ctrl, shift, alt].every((flag) => typeof flag === "boolean")) return null;
  return {
    key,
    mod: mod as boolean,
    ctrl: ctrl as boolean,
    shift: shift as boolean,
    alt: alt as boolean,
  };
}

/** The shortcuts a `lattice:host-shortcuts` message carries, or null for anything else. */
export function parseLatticeHostShortcuts(data: unknown): LatticeHostShortcut[] | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  if (message.type !== LATTICE_HOST_SHORTCUTS || message.version !== 1) return null;
  if (!Array.isArray(message.shortcuts) || message.shortcuts.length > MAX_SHORTCUTS) return null;
  return message.shortcuts.flatMap((value) => parseShortcut(value) ?? []);
}

/**
 * Whether `press` is `shortcut`, matched exactly as Lattice matches its own
 * keys: ⌘? is ⌘⇧/, and with ⌥ held a digit or letter is read from the key's
 * position (⌥1 types ¡ on a Mac).
 */
export function pressMatchesHostShortcut(shortcut: LatticeHostShortcut, press: KeyPress): boolean {
  const key =
    press.altKey && /^(Digit\d|Key[A-Z])$/.test(press.code)
      ? press.code.slice(-1).toLocaleLowerCase()
      : press.key === "/" && press.shiftKey
        ? "?"
        : press.key.toLocaleLowerCase();
  return (
    shortcut.key === key &&
    shortcut.shift === press.shiftKey &&
    shortcut.alt === press.altKey &&
    (shortcut.ctrl
      ? press.ctrlKey && !press.metaKey
      : shortcut.mod === (press.metaKey || press.ctrlKey))
  );
}

/**
 * Start leaving Lattice's keys to Lattice. Runs before the first render, so
 * its capture listener on the window is ahead of every shortcut listener this
 * app adds.
 */
export function startLatticeHostShortcuts(): () => void {
  const config = readEmbedMode();
  const hostOrigin = config?.hostOrigin;
  if (!hostOrigin || window.parent === window) return () => undefined;
  let shortcuts: LatticeHostShortcut[] = [];
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== hostOrigin) return;
    const next = parseLatticeHostShortcuts(event.data);
    if (next) shortcuts = next;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    // A key an IME is composing is text, whatever it matches.
    if (event.isComposing || event.defaultPrevented) return;
    if (!shortcuts.some((shortcut) => pressMatchesHostShortcut(shortcut, event))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.parent.postMessage(
      {
        type: SYNARA_HOST_SHORTCUT,
        version: 1,
        key: event.key,
        code: event.code,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      },
      hostOrigin,
    );
  };
  window.addEventListener("message", onMessage);
  window.addEventListener("keydown", onKeyDown, { capture: true });
  window.parent.postMessage({ type: LATTICE_HOST_SHORTCUTS_REQUEST, version: 1 }, hostOrigin);
  return () => {
    window.removeEventListener("message", onMessage);
    window.removeEventListener("keydown", onKeyDown, { capture: true });
  };
}

// FILE: imeComposition.test.ts
// Purpose: Guards the IME keydown guard against both browser composition
//          event orders (Chrome keydown-first, WebKit compositionend-first).
// Layer: Web input utility tests

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createImeKeyGuard } from "./imeComposition";

describe("createImeKeyGuard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores keys that report a live composition", () => {
    const guard = createImeKeyGuard();
    expect(guard.shouldIgnoreKeyDown({ key: "Enter", isComposing: true })).toBe(true);
    expect(guard.shouldIgnoreKeyDown({ key: "Escape", isComposing: true })).toBe(true);
    expect(guard.shouldIgnoreKeyDown({ key: "Process", keyCode: 229 })).toBe(true);
  });

  it("passes ordinary typing through untouched", () => {
    const guard = createImeKeyGuard();
    expect(guard.shouldIgnoreKeyDown({ key: "Enter", isComposing: false })).toBe(false);
    expect(guard.shouldIgnoreKeyDown({ key: "a", isComposing: false })).toBe(false);
  });

  it("swallows WebKit's post-compositionend commit Enter until its keyup", () => {
    const guard = createImeKeyGuard();
    guard.onCompositionStart();
    // WebKit order: compositionend arrives BEFORE the confirming Enter keydown,
    // which then reports isComposing false.
    guard.onCompositionEnd();
    expect(guard.shouldIgnoreKeyDown({ key: "Enter", isComposing: false })).toBe(true);
    guard.onKeyUp();
    expect(guard.shouldIgnoreKeyDown({ key: "Enter", isComposing: false })).toBe(false);
  });

  it("lets rollover typing through the post-commit window", () => {
    const guard = createImeKeyGuard();
    guard.onCompositionStart();
    guard.onCompositionEnd();
    // The next character can be pressed before the commit key's keyup.
    expect(guard.shouldIgnoreKeyDown({ key: "a", isComposing: false })).toBe(false);
  });

  it("does not swallow a genuine Enter after the Chrome event order", () => {
    const guard = createImeKeyGuard();
    guard.onCompositionStart();
    // Chrome order: the commit keydown still reports isComposing true, then
    // compositionend, then the commit key's keyup.
    expect(guard.shouldIgnoreKeyDown({ key: "Enter", isComposing: true })).toBe(true);
    guard.onCompositionEnd();
    guard.onKeyUp();
    expect(guard.shouldIgnoreKeyDown({ key: "Enter", isComposing: false })).toBe(false);
  });

  it("closes the post-commit window on its own when the keyup is lost", () => {
    const guard = createImeKeyGuard();
    guard.onCompositionStart();
    guard.onCompositionEnd();
    vi.advanceTimersByTime(600);
    expect(guard.shouldIgnoreKeyDown({ key: "Enter", isComposing: false })).toBe(false);
  });

  it("clears composition state and its fallback timer when disposed", () => {
    const guard = createImeKeyGuard();
    guard.onCompositionStart();
    guard.onCompositionEnd();

    guard.dispose();

    expect(vi.getTimerCount()).toBe(0);
    expect(guard.shouldIgnoreKeyDown({ key: "Enter", isComposing: false })).toBe(false);
  });

  it("resyncs after a missed compositionend instead of swallowing keys forever", () => {
    const guard = createImeKeyGuard();
    guard.onCompositionStart();
    // No compositionend seen (listener attached mid-session). The first
    // non-composing keydown is still treated as the potential commit…
    expect(guard.shouldIgnoreKeyDown({ key: "Enter", isComposing: false })).toBe(true);
    guard.onKeyUp();
    // …but the guard has resynced: later keys behave normally.
    expect(guard.shouldIgnoreKeyDown({ key: "ArrowDown", isComposing: false })).toBe(false);
    expect(guard.shouldIgnoreKeyDown({ key: "Enter", isComposing: false })).toBe(false);
  });
});

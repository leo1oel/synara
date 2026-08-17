// FILE: imeComposition.ts
// Purpose: Keydown guard that keeps IME composition keys (CJK candidate
//          selection) from triggering app shortcuts like Enter-to-send.
// Layer: Web input utilities
// Exports: createImeKeyGuard, ImeKeyGuard

// Keys IMEs use to act on the candidate list. Only these are swallowed in the
// post-commit window: swallowing arbitrary keys there would eat rollover typing
// (the next character pressed before the commit key is released).
const IME_COMMIT_KEYS = new Set(["Enter", "Tab", "Escape"]);

// How long the post-commit window may stay open without seeing a keyup.
// Normally the commit key's own keyup closes it; the timer only covers a keyup
// lost to a focus change right as the composition ends.
const COMMIT_WINDOW_FALLBACK_MS = 500;

export interface ImeKeyGuard {
  onCompositionStart(): void;
  onCompositionEnd(): void;
  onKeyUp(): void;
  /** Clears pending composition state and timers when the owning input unmounts. */
  dispose(): void;
  /** True when the keydown belongs to the IME session and must not run app shortcuts. */
  shouldIgnoreKeyDown(event: {
    readonly isComposing?: boolean;
    readonly keyCode?: number;
    readonly key?: string;
  }): boolean;
}

// `event.isComposing` alone cannot express "this Enter picked a candidate":
// WebKit fires `compositionend` BEFORE the keydown of the Enter that confirmed
// the composition, so that keydown arrives with `isComposing === false` and
// sails through a naive guard — turning "select the first candidate" into
// "send the message". Track the session ourselves and hold a post-commit
// window open until the commit key's keyup.
export function createImeKeyGuard(): ImeKeyGuard {
  let composing = false;
  let inCommitWindow = false;
  let commitWindowTimer: ReturnType<typeof setTimeout> | null = null;

  const closeCommitWindow = () => {
    inCommitWindow = false;
    if (commitWindowTimer !== null) {
      clearTimeout(commitWindowTimer);
      commitWindowTimer = null;
    }
  };
  const openCommitWindow = () => {
    inCommitWindow = true;
    if (commitWindowTimer !== null) clearTimeout(commitWindowTimer);
    commitWindowTimer = setTimeout(closeCommitWindow, COMMIT_WINDOW_FALLBACK_MS);
  };

  return {
    onCompositionStart() {
      composing = true;
      closeCommitWindow();
    },
    onCompositionEnd() {
      composing = false;
      openCommitWindow();
    },
    onKeyUp() {
      closeCommitWindow();
    },
    dispose() {
      composing = false;
      closeCommitWindow();
    },
    shouldIgnoreKeyDown(event) {
      if (event.isComposing || event.keyCode === 229) {
        return true;
      }
      if (composing) {
        // A keydown reporting no live composition means our compositionend was
        // missed (listener attached mid-session, root remounted). Resync
        // instead of swallowing every key forever, but still treat this
        // keystroke as the potential commit below.
        composing = false;
        openCommitWindow();
      }
      return inCommitWindow && event.key !== undefined && IME_COMMIT_KEYS.has(event.key);
    },
  };
}

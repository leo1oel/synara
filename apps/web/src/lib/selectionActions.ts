// FILE: selectionActions.ts
// Purpose: Shared timing policy for controls that appear after selecting text.
// Layer: Browser interaction helper

const MULTI_CLICK_SELECTION_ACTION_DELAY_MS = 260;

export function selectionActionDelayForClickCount(clickCount: number): number {
  return clickCount >= 2 ? MULTI_CLICK_SELECTION_ACTION_DELAY_MS : 0;
}

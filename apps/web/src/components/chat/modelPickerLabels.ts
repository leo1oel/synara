// FILE: modelPickerLabels.ts
// Purpose: Translate the fixed English trait words the model picker shows: effort ladder
//   steps and context options from the shared model catalog, plus the picker's own
//   "Thinking On" / "Fast" / "Unavailable" summary words.
// Layer: Web presentation helper
//
// The catalog in `@synara/contracts` and providers' live catalogs stay locale-free, so the
// picker translates at render time. Anything not listed here (model names, "1M", agent
// names, a provider's own wording) passes through unchanged.

import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

// "Thinking" alone already means the live "thinking…" status elsewhere in the catalog.
const THINKING_TRAIT = msg({ message: "Thinking", context: "model trait" });

export function localizeModelPickerLabel(i18n: I18n, label: string): string {
  switch (label) {
    case "None":
      return i18n._("None");
    case "Minimal":
      return i18n._("Minimal");
    case "Low":
      return i18n._("Low");
    case "Medium":
      return i18n._("Medium");
    case "High":
      return i18n._("High");
    case "Extra High":
    case "XHigh":
      return i18n._("Extra High");
    case "Max":
    case "Maximum":
      return i18n._("Max");
    case "Ultra":
      return i18n._("Ultra");
    case "Off":
      return i18n._("Off");
    case "Auto-compact":
      return i18n._("Auto-compact");
    case "Thinking":
      return i18n._(THINKING_TRAIT);
    case "Thinking On":
      return i18n._("Thinking on");
    case "Thinking Off":
      return i18n._("Thinking off");
    case "Fast":
      return i18n._("Fast");
    case "Unavailable":
      return i18n._("Unavailable");
    default:
      return label;
  }
}

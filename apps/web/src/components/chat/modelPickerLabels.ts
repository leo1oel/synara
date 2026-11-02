import { t } from "~/i18n";

// "Thinking" alone already means the live "thinking…" status elsewhere in the catalog.
const THINKING_TRAIT = "lattice:modelTraitThinking";

export function localizeModelPickerLabel(translate: typeof t, label: string): string {
  switch (label) {
    case "None":
      return translate("chat:none");
    case "Minimal":
      return translate("chat:effortMinimal");
    case "Low":
      return translate("common:task_priority_low");
    case "Medium":
      return translate("common:task_priority_medium");
    case "High":
      return translate("common:task_priority_high");
    case "Extra High":
    case "XHigh":
      return translate("chat:effortExtraHigh");
    case "Max":
    case "Maximum":
      return translate("chat:effortMax");
    case "Ultra":
      return translate("chat:effortUltra");
    case "Off":
      return translate("automation:traitsPicker_off");
    case "Auto-compact":
      return translate("chat:traitAutoCompact");
    case "Thinking":
      return translate(THINKING_TRAIT);
    case "Thinking On":
      return translate("lattice:thinkingOn");
    case "Thinking Off":
      return translate("lattice:thinkingOff");
    case "Fast":
      return translate("chat:traitsPicker_fast");
    case "Unavailable":
      return translate("chat:providerModelPicker_unavailable");
    default:
      return label;
  }
}

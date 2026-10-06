import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// These assertions describe the select contract, not where the formatter chose
// to break a line. oxfmt wraps long ternaries, so match against a
// whitespace-normalized copy instead of re-pinning every literal each time
// formatting changes.
function readNormalized(url: URL): string {
  return readFileSync(url, "utf8").replace(/\s+/gu, " ");
}

const SELECT_SOURCE = readNormalized(new URL("../ui/select.tsx", import.meta.url));
const SETTINGS_ROUTE_SOURCE = readNormalized(
  new URL("../../routes/_chat.settings.tsx", import.meta.url),
);
const MODEL_SETTINGS_SOURCE = readNormalized(new URL("./ModelsSettingsPanel.tsx", import.meta.url));
const THEME_EDITOR_SOURCE = readNormalized(new URL("../ThemePackEditor.tsx", import.meta.url));

describe("Settings select contract", () => {
  it("never lets a Settings popup hide its selected-state check", () => {
    expect(SELECT_SOURCE).toMatch(/popupSurface === "settings" \? false/);
    expect(SELECT_SOURCE).toContain("<CheckIcon aria-hidden");

    for (const source of [SETTINGS_ROUTE_SOURCE, MODEL_SETTINGS_SOURCE, THEME_EDITOR_SOURCE]) {
      expect(source).not.toContain("hideIndicator");
    }
  });

  it("reserves one leading indicator column for every Settings option", () => {
    expect(SELECT_SOURCE).toContain("grid-cols-[16px_minmax(0,1fr)]");
    expect(SELECT_SOURCE).toContain('popupSurface === "settings" ? "col-start-2"');
    expect(SELECT_SOURCE).toContain(
      'popupSurface === "settings" ? "col-start-1 justify-self-center"',
    );
  });

  it("uses the same quick reduced-motion-safe highlight transition", () => {
    expect(SELECT_SOURCE).toContain(
      "transition-[color,background-color] duration-120 ease-out motion-reduce:transition-none",
    );
  });
});

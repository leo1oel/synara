import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const INDEX_CSS = readFileSync(new URL("./index.css", import.meta.url), "utf8");
const FIELD_BLOCK_START = INDEX_CSS.indexOf("/* Settings uses the same one-owner field contract");
const FIELD_BLOCK_END = INDEX_CSS.indexOf(
  "/* Select popups are portalled outside .app-settings-surface",
  FIELD_BLOCK_START,
);
const EMBEDDED_SETTINGS_FIELD_CSS = INDEX_CSS.slice(FIELD_BLOCK_START, FIELD_BLOCK_END);

describe("embedded Settings field styles", () => {
  it("styles the field shell instead of drawing a second native-input border", () => {
    expect(FIELD_BLOCK_START).toBeGreaterThan(-1);
    expect(FIELD_BLOCK_END).toBeGreaterThan(FIELD_BLOCK_START);
    expect(EMBEDDED_SETTINGS_FIELD_CSS).toContain('[data-slot="input-control"]');
    expect(EMBEDDED_SETTINGS_FIELD_CSS).toContain('[data-slot="textarea-control"]');
    expect(EMBEDDED_SETTINGS_FIELD_CSS).toContain('[data-slot="input-control"] > [data-slot="input"]');
    expect(EMBEDDED_SETTINGS_FIELD_CSS).toContain("border: 0 !important");
    expect(EMBEDDED_SETTINGS_FIELD_CSS).not.toContain('input:not([type="checkbox"]):not([type="radio"])');
  });

  it("keeps embedded fields on their shared component heights", () => {
    expect(EMBEDDED_SETTINGS_FIELD_CSS).not.toContain("height: 38px");
    expect(EMBEDDED_SETTINGS_FIELD_CSS).not.toContain("min-height: 38px");
  });

  it("uses the same 12 to 24 percent border contrast step as Lattice fields", () => {
    expect(EMBEDDED_SETTINGS_FIELD_CSS).toContain("var(--lattice-settings-text) 12%");
    expect(EMBEDDED_SETTINGS_FIELD_CSS).toContain("var(--lattice-settings-text) 24%");
  });
});

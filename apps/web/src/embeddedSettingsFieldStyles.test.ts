import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// These assertions describe the CSS contract, not where the formatter chose to
// break a line. oxfmt wraps long selector lists and property values, so match
// against a whitespace-normalized copy instead of re-pinning every literal each
// time formatting changes.
const INDEX_CSS = readFileSync(new URL("./index.css", import.meta.url), "utf8").replace(
  /\s+/gu,
  " ",
);
const CONTROL_LAYOUT_BLOCK_START = INDEX_CSS.indexOf(
  'html[data-synara-embed="true"] .app-settings-surface [data-slot="settings-control"]',
);
const CONTROL_LAYOUT_BLOCK_END = INDEX_CSS.indexOf(
  'html[data-synara-embed="true"] .app-settings-surface [data-slot="settings-row"] [data-slot="select-trigger"]',
  CONTROL_LAYOUT_BLOCK_START,
);
const FIELD_BLOCK_START = INDEX_CSS.indexOf("/* Settings uses the same one-owner field contract");
const FIELD_BLOCK_END = INDEX_CSS.indexOf(
  "/* Select popups are portalled outside .app-settings-surface",
  FIELD_BLOCK_START,
);
const TYPOGRAPHY_BLOCK_START = INDEX_CSS.indexOf(
  'html[data-synara-embed="true"] .app-settings-surface [data-slot="button"]',
);
const POPUP_BLOCK_START = FIELD_BLOCK_END;
const POPUP_BLOCK_END = INDEX_CSS.indexOf(
  'html[data-synara-embed="true"] .app-settings-surface .rounded-xl',
  POPUP_BLOCK_START,
);
const EMBEDDED_SETTINGS_TYPOGRAPHY_CSS = INDEX_CSS.slice(TYPOGRAPHY_BLOCK_START, FIELD_BLOCK_START);
const EMBEDDED_SETTINGS_FIELD_CSS = INDEX_CSS.slice(FIELD_BLOCK_START, FIELD_BLOCK_END);
const EMBEDDED_SETTINGS_POPUP_CSS = INDEX_CSS.slice(POPUP_BLOCK_START, POPUP_BLOCK_END);
const EMBEDDED_SETTINGS_CONTROL_LAYOUT_CSS = INDEX_CSS.slice(
  CONTROL_LAYOUT_BLOCK_START,
  CONTROL_LAYOUT_BLOCK_END,
);

describe("embedded Settings field styles", () => {
  it("styles the field shell instead of drawing a second native-input border", () => {
    expect(FIELD_BLOCK_START).toBeGreaterThan(-1);
    expect(FIELD_BLOCK_END).toBeGreaterThan(FIELD_BLOCK_START);
    expect(EMBEDDED_SETTINGS_FIELD_CSS).toContain('[data-slot="input-control"]');
    expect(EMBEDDED_SETTINGS_FIELD_CSS).toContain('[data-slot="textarea-control"]');
    expect(EMBEDDED_SETTINGS_FIELD_CSS).toContain(
      '[data-slot="input-control"] > [data-slot="input"]',
    );
    expect(EMBEDDED_SETTINGS_FIELD_CSS).toContain("border: 0 !important");
    expect(EMBEDDED_SETTINGS_FIELD_CSS).not.toContain(
      'input:not([type="checkbox"]):not([type="radio"])',
    );
  });

  it("keeps embedded fields on their shared component heights", () => {
    expect(EMBEDDED_SETTINGS_FIELD_CSS).toContain("height: var(--lattice-settings-control-height)");
    expect(EMBEDDED_SETTINGS_FIELD_CSS).not.toContain("height: 36px");
    expect(EMBEDDED_SETTINGS_FIELD_CSS).not.toContain("min-height: 36px");
    expect(EMBEDDED_SETTINGS_FIELD_CSS).not.toContain("height: 38px");
    expect(EMBEDDED_SETTINGS_FIELD_CSS).not.toContain("min-height: 38px");
  });

  it("reserves the fixed trailing column for form controls without stretching list actions", () => {
    expect(CONTROL_LAYOUT_BLOCK_START).toBeGreaterThan(-1);
    expect(CONTROL_LAYOUT_BLOCK_END).toBeGreaterThan(CONTROL_LAYOUT_BLOCK_START);
    expect(EMBEDDED_SETTINGS_CONTROL_LAYOUT_CSS).toContain('[data-slot="settings-control"]');
    expect(EMBEDDED_SETTINGS_CONTROL_LAYOUT_CSS).toContain(
      "width: var(--lattice-settings-control-width)",
    );
    expect(EMBEDDED_SETTINGS_CONTROL_LAYOUT_CSS).not.toContain('[data-slot="settings-actions"]');
    expect(EMBEDDED_SETTINGS_CONTROL_LAYOUT_CSS).not.toContain(":only-child");
  });

  it("keeps the Skills action and full-width form copy on the embedded settings grid", () => {
    expect(INDEX_CSS).toContain(".skills-library-actions { width: 100%;");
    expect(INDEX_CSS).toContain(
      ".skills-library-menu { width: var(--lattice-settings-control-width); min-width: var(--lattice-settings-control-width);",
    );
    expect(INDEX_CSS).toContain(
      ".managed-skill-field-label { display: block; font-size: var(--lattice-type-label-size); line-height: var(--lattice-type-label-line-height);",
    );
    expect(INDEX_CSS).toContain(
      ".managed-skill-field-help { font-size: var(--lattice-type-caption-size); line-height: var(--lattice-type-caption-line-height);",
    );
  });

  it("uses the same 12 to 24 percent border contrast step as Lattice fields", () => {
    expect(EMBEDDED_SETTINGS_FIELD_CSS).toContain("var(--lattice-settings-text) 12%");
    expect(EMBEDDED_SETTINGS_FIELD_CSS).toContain("var(--lattice-settings-text) 24%");
  });

  it("uses one typography contract for buttons, fields, and dropdown options", () => {
    expect(TYPOGRAPHY_BLOCK_START).toBeGreaterThan(-1);
    expect(EMBEDDED_SETTINGS_TYPOGRAPHY_CSS).toContain(
      "font-size: var(--lattice-settings-control-font-size)",
    );
    expect(EMBEDDED_SETTINGS_TYPOGRAPHY_CSS).toContain(
      "font-weight: var(--lattice-settings-control-font-weight)",
    );
    expect(EMBEDDED_SETTINGS_TYPOGRAPHY_CSS).not.toContain("font-weight: 600");
    expect(EMBEDDED_SETTINGS_FIELD_CSS).toContain("font-weight: inherit");
    expect(POPUP_BLOCK_END).toBeGreaterThan(POPUP_BLOCK_START);
    expect(EMBEDDED_SETTINGS_POPUP_CSS).toContain(
      "font-size: var(--lattice-settings-control-font-size)",
    );
    expect(EMBEDDED_SETTINGS_POPUP_CSS).toContain(
      "line-height: var(--lattice-settings-control-line-height)",
    );
    expect(EMBEDDED_SETTINGS_POPUP_CSS).toContain(
      "font-weight: var(--lattice-settings-control-font-weight)",
    );
  });
});

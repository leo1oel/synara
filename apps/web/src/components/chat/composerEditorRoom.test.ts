import { describe, expect, it } from "vitest";

import {
  COMPOSER_EDITOR_MAX_HEIGHT_PX,
  COMPOSER_EDITOR_MIN_HEIGHT_PX,
  COMPOSER_TOP_CLEARANCE_PX,
  composerEditorMaxHeightPx,
} from "./composerEditorRoom";

describe("composerEditorMaxHeightPx", () => {
  it("leaves the fixed cap in place when the column has room for it", () => {
    expect(composerEditorMaxHeightPx({ editorHeightPx: 200, freeAbovePx: 120 })).toBeNull();
    expect(
      composerEditorMaxHeightPx({
        editorHeightPx: 21,
        freeAbovePx: COMPOSER_EDITOR_MAX_HEIGHT_PX - 21 + COMPOSER_TOP_CLEARANCE_PX,
      }),
    ).toBeNull();
  });

  it("caps the editor at what the column leaves once the composer would overflow it", () => {
    // A 174px Agent panel: the composer's top edge sat 126px above the column.
    expect(composerEditorMaxHeightPx({ editorHeightPx: 200, freeAbovePx: -126 })).toBe(66);
    // Never below two lines, even where the column cannot hold the rest of the composer.
    expect(composerEditorMaxHeightPx({ editorHeightPx: 200, freeAbovePx: -190 })).toBe(
      COMPOSER_EDITOR_MIN_HEIGHT_PX,
    );
    // Room for 150px of editor: the composer stops 8px below the column's top.
    expect(
      composerEditorMaxHeightPx({
        editorHeightPx: 200,
        freeAbovePx: -50 + COMPOSER_TOP_CLEARANCE_PX,
      }),
    ).toBe(150);
  });

  it("gives the same cap before and after it applies, so it never oscillates", () => {
    const before = composerEditorMaxHeightPx({ editorHeightPx: 200, freeAbovePx: -30 });
    expect(before).toBe(162);
    // Applying it shrinks the editor by 38px and lowers the composer's top edge by as much.
    expect(composerEditorMaxHeightPx({ editorHeightPx: 162, freeAbovePx: 8 })).toBe(before);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const INDEX_CSS = readFileSync(new URL("./index.css", import.meta.url), "utf8").replace(
  /\s+/gu,
  " ",
);
const EMBED_MODE = readFileSync(new URL("./embedMode.ts", import.meta.url), "utf8");
const GIT_PANEL = readFileSync(
  new URL("./components/chat/GitPanel.tsx", import.meta.url),
  "utf8",
);
const BRANCH_SELECTOR = readFileSync(
  new URL("./components/BranchToolbarBranchSelector.tsx", import.meta.url),
  "utf8",
);
const GIT_ACTIONS = readFileSync(
  new URL("./components/GitActionsControl.tsx", import.meta.url),
  "utf8",
);

describe("embedded Source Control picker styles", () => {
  it("scopes trigger and portalled popup chrome to the explicit embed contract", () => {
    expect(INDEX_CSS).toContain(
      'html[data-synara-embed="true"] [data-lattice-source-control="true"]',
    );
    expect(INDEX_CSS).toContain(
      'html[data-synara-embed="true"] .lattice-source-control-popup',
    );
    expect(INDEX_CSS).toContain('[data-lattice-source-control-split="true"]');
    expect(INDEX_CSS).toContain('[data-slot="menu-item"]');
    expect(INDEX_CSS).toContain('[data-slot="combobox-item"]');
    expect(INDEX_CSS).not.toContain('button[aria-label="More Git actions"]');
  });

  it("wires both Source Control pickers to Lattice's shared embed tokens", () => {
    expect(GIT_PANEL).toContain("latticeSourceControl");
    expect(BRANCH_SELECTOR).toContain("data-lattice-source-control");
    expect(GIT_ACTIONS).toContain("data-lattice-source-control-split");
    expect(INDEX_CSS).toContain("var(--lattice-settings-control-height)");
    expect(INDEX_CSS).toContain("var(--lattice-settings-control-radius)");
    expect(INDEX_CSS).toContain("var(--lattice-control-hover-surface)");
    expect(INDEX_CSS).toContain("var(--lattice-floating-surface-shadow)");
    expect(EMBED_MODE).toContain('"--lattice-control-hover-surface"');
    expect(EMBED_MODE).toContain('"--lattice-floating-surface-shadow"');
  });
});

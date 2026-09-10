import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { LATTICE_HOST_CONTEXT } from "../../embedMode";
import { setLiveLatticeHostContext } from "../../lib/latticeHostContext";
import { ComposerColumnFrame } from "./ComposerColumnFrame";
import { ComposerLatticeContextBar } from "./ComposerLatticeContextBar";

afterEach(() => {
  setLiveLatticeHostContext(null);
  document.body.innerHTML = "";
});

it("keeps the bottom of a long context selection inside its scroll area", async () => {
  setLiveLatticeHostContext({
    type: LATTICE_HOST_CONTEXT,
    version: 1,
    workspaceRoot: "/Users/me/paper",
    activeSurface: "editor",
    editor: {
      path: "sections/introduction.tex",
      line: 42,
      column: 7,
      selection: Array.from(
        { length: 24 },
        (_, index) => `Selected context line ${index + 1}`,
      ).join("\n"),
    },
    pdf: { page: 4, pageCount: 12 },
  });
  await render(
    <div className="w-[420px] p-4">
      <ComposerColumnFrame>
        <ComposerLatticeContextBar />
        <div data-testid="composer" className="h-24 border bg-background p-3">
          Composer
        </div>
      </ComposerColumnFrame>
    </div>,
  );

  await page.getByRole("button", { name: "Show included context details" }).click();
  await new Promise((resolve) => window.setTimeout(resolve, 250));
  const root = page.getByTestId("composer-lattice-context").element();
  const viewport = root.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']");
  const scrollArea = root.querySelector<HTMLElement>("[data-slot='scroll-area']");
  if (!viewport || !scrollArea) throw new Error("Expected context scroll area");
  viewport.scrollTop = viewport.scrollHeight;
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

  const selectionPreview = scrollArea.querySelector("pre");
  if (!selectionPreview) throw new Error("Expected selection preview");
  expect(selectionPreview.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    page.getByTestId("composer").element().getBoundingClientRect().top,
  );
  await page.screenshot();
});

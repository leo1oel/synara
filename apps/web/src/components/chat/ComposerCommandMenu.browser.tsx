import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ComposerCommandMenu, type ComposerCommandItem } from "./ComposerCommandMenu";

async function mountMenu(input: {
  isLoading: boolean;
  triggerKind: "mention" | "skill" | "slash-command" | null;
  emptyStateText?: string;
  items?: ComposerCommandItem[];
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <ComposerCommandMenu
      items={input.items ?? []}
      resolvedTheme="dark"
      isLoading={input.isLoading}
      triggerKind={input.triggerKind}
      {...(input.emptyStateText === undefined ? {} : { emptyStateText: input.emptyStateText })}
      activeItemId={null}
      onHighlightedItemChange={vi.fn()}
      onSelect={vi.fn()}
    />,
    { container: host },
  );

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("ComposerCommandMenu empty states", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it.each([
    ["mention", "mention", "Searching mentions..."],
    ["skill", "skill", "Loading skills..."],
    ["slash command", "slash-command", "Loading commands..."],
  ] as const)(
    "shows the %s loading label before results are available",
    async (_label, triggerKind, text) => {
      const menu = await mountMenu({ isLoading: true, triggerKind });

      try {
        await expect.element(page.getByText(text, { exact: true })).toBeVisible();
        if (triggerKind === "mention") {
          await expect.element(page.getByText("Files", { exact: true })).toBeVisible();
        } else {
          expect(document.querySelector('[data-slot="command-list"]')).toBeNull();
        }
      } finally {
        await menu.cleanup();
      }
    },
  );

  it("uses the supplied empty copy after loading completes", async () => {
    const menu = await mountMenu({
      isLoading: false,
      triggerKind: "slash-command",
      emptyStateText: "No commands are available for this provider.",
    });

    try {
      await expect
        .element(page.getByText("No commands are available for this provider.", { exact: true }))
        .toBeVisible();
      expect(document.body.textContent).not.toContain("Loading commands...");
    } finally {
      await menu.cleanup();
    }
  });
});

describe("ComposerCommandMenu mention groups", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("styles the empty file hint like the other mention group labels", async () => {
    const menu = await mountMenu({
      isLoading: false,
      triggerKind: "mention",
      items: [
        {
          id: "paper:.research/papers/1706.03762/paper.md",
          type: "paper",
          arxivId: "1706.03762",
          view: "fulltext",
          mention: {
            name: "Attention Is All You Need",
            path: ".research/papers/1706.03762/paper.md",
          },
          label: "Attention Is All You Need",
          description: "Full text",
        },
      ],
    });

    try {
      const filesLabel = [...document.querySelectorAll("p")].find(
        (node) => node.textContent === "Files",
      );
      const papersLabel = document.querySelector('[data-slot="command-group-label"]');
      expect(filesLabel).toBeInstanceOf(HTMLElement);
      expect(papersLabel).toBeInstanceOf(HTMLElement);

      const pickTypography = (element: Element) => {
        const style = getComputedStyle(element);
        return {
          color: style.color,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        };
      };
      expect(pickTypography(filesLabel!)).toEqual(pickTypography(papersLabel!));
    } finally {
      await menu.cleanup();
    }
  });

  it("shows project files before other mention sources", async () => {
    const menu = await mountMenu({
      isLoading: false,
      triggerKind: "mention",
      items: [
        {
          id: "paper:.research/papers/1706.03762/paper.md",
          type: "paper",
          arxivId: "1706.03762",
          view: "fulltext",
          mention: {
            name: "Attention Is All You Need",
            path: ".research/papers/1706.03762/paper.md",
          },
          label: "Attention Is All You Need",
          description: "Full text",
        },
        {
          id: "path:file:main.tex",
          type: "path",
          path: "main.tex",
          pathKind: "file",
          label: "main.tex",
          description: "",
        },
      ],
    });

    try {
      const labels = [...document.querySelectorAll('[data-slot="command-group-label"]')].map(
        (node) => node.textContent?.trim(),
      );
      expect(labels.slice(0, 2)).toEqual(["Files · 1", "Papers · 1"]);
      await expect.element(page.getByText("main.tex", { exact: true })).toBeVisible();
    } finally {
      await menu.cleanup();
    }
  });
});

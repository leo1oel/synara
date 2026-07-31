import { describe, expect, it } from "vitest";

import { skillIdFromDisplayName, skillInstructionsFromMarkdown } from "./skillEditorModel";

describe("skillIdFromDisplayName", () => {
  it("creates a valid lowercase folder identifier", () => {
    expect(skillIdFromDisplayName("  Literature Review  ")).toBe("literature-review");
    expect(skillIdFromDisplayName("Café & Notes")).toBe("cafe-notes");
  });

  it("provides a safe fallback when a display name has no ASCII identifier", () => {
    expect(skillIdFromDisplayName("研究品味")).toBe("my-skill");
  });
});

describe("skillInstructionsFromMarkdown", () => {
  it("removes frontmatter without changing the instruction body", () => {
    expect(
      skillInstructionsFromMarkdown(`---
name: paper-review
description: Review papers
---

# Review papers

Check the evidence.`),
    ).toBe("# Review papers\n\nCheck the evidence.");
  });

  it("supports skills created with Windows line endings", () => {
    expect(
      skillInstructionsFromMarkdown(
        "---\r\nname: paper-review\r\ndescription: Review papers\r\n---\r\n\r\nDo the review.",
      ),
    ).toBe("Do the review.");
  });
});

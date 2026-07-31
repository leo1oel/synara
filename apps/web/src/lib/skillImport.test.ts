import { describe, expect, it } from "vitest";

import { prepareSkillSelection, type BrowserSkillFile } from "./skillImport";

function browserFile(path: string, size = 1): BrowserSkillFile {
  return {
    name: path.split("/").at(-1) ?? path,
    size,
    webkitRelativePath: path,
    arrayBuffer: async () => new ArrayBuffer(size),
  };
}

describe("prepareSkillSelection", () => {
  it("keeps the complete selected skill directory with paths relative to SKILL.md", () => {
    const selection = prepareSkillSelection([
      browserFile("paper-review/SKILL.md"),
      browserFile("paper-review/references/checklist.md"),
      browserFile("paper-review/scripts/review.ts"),
    ]);

    expect(selection.folderName).toBe("paper-review");
    expect(selection.files.map((file) => file.relativePath)).toEqual([
      "references/checklist.md",
      "scripts/review.ts",
      "SKILL.md",
    ]);
  });

  it("finds one skill nested inside a selected repository and excludes unrelated files", () => {
    const selection = prepareSkillSelection([
      browserFile("repo/README.md"),
      browserFile("repo/skills/paper-review/SKILL.md"),
      browserFile("repo/skills/paper-review/references/checklist.md"),
    ]);

    expect(selection.folderName).toBe("paper-review");
    expect(selection.files.map((file) => file.relativePath)).toEqual(["references/checklist.md", "SKILL.md"]);
  });

  it("rejects folders without a skill manifest or with multiple skills", () => {
    expect(() => prepareSkillSelection([browserFile("notes/README.md")])).toThrow("containing a SKILL.md");
    expect(() =>
      prepareSkillSelection([browserFile("skills/one/SKILL.md"), browserFile("skills/two/SKILL.md")]),
    ).toThrow("one skill folder");
  });
});

import { describe, expect, it } from "vitest";

import { readPatchSectionPath } from "./gitPatchPaths";
import { splitPatchByFile } from "./proseDiff";

// Captured from `git diff` with the default core.quotePath (Lattice audit Q3).
const QUOTED_PATCH = [
  'diff --git "a/x-\\344\\270\\255\\346\\226\\207.tex" "b/x-\\344\\270\\255\\346\\226\\207.tex"',
  "index 7898192..5abc8f6 100644",
  '--- "a/x-\\344\\270\\255\\346\\226\\207.tex"',
  '+++ "b/x-\\344\\270\\255\\346\\226\\207.tex"',
  "@@ -1 +1,2 @@",
  " a",
  "+more",
  'diff --git "a/has space \\"q\\".tex" "b/has space \\"q\\".tex"',
  "index 6178079..1ff0c42 100644",
  '--- "a/has space \\"q\\".tex"\t',
  '+++ "b/has space \\"q\\".tex"\t',
  "@@ -1 +1,2 @@",
  " b",
  "+more",
  'diff --git "a/tab\\there.tex" "b/tab\\there.tex"',
  "index 3410062..5d2c6b2 100644",
  '--- "a/tab\\there.tex"',
  '+++ "b/tab\\there.tex"',
  "@@ -1 +1,2 @@",
  " c",
  "+more",
  'diff --git "a/back\\\\slash.tex" "b/back\\\\slash.tex"',
  "deleted file mode 100644",
  "index 4bcfe98..0000000",
  '--- "a/back\\\\slash.tex"',
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-d",
  'diff --git "a/has space \\"q\\".tex" "b/moved \\"q\\" \\344\\270\\255.tex"',
  "similarity index 100%",
  'rename from "has space \\"q\\".tex"',
  'rename to "moved \\"q\\" \\344\\270\\255.tex"',
  "diff --git a/with space.tex b/with space.tex",
  "index 587be6b..b77b4eb 100644",
  "--- a/with space.tex\t",
  "+++ b/with space.tex\t",
  "@@ -1 +1,2 @@",
  " x",
  "+y",
  'diff --git "a/\\345\\233\\276.png" "b/\\345\\233\\276.png"',
  "index 0a7e2a1..f584f40 100644",
  'Binary files "a/\\345\\233\\276.png" and "b/\\345\\233\\276.png" differ',
  "",
].join("\n");

describe("readPatchSectionPath", () => {
  it("keys each section by the name Git stores, decoding only quoted paths", () => {
    expect([...splitPatchByFile(QUOTED_PATCH).keys()]).toEqual([
      "x-中文.tex",
      'has space "q".tex',
      "tab\there.tex",
      "back\\slash.tex",
      'moved "q" 中.tex',
      "with space.tex",
      "图.png",
    ]);
  });

  it("reads raw UTF-8 inside quotes and leaves unquoted backslashes literal", () => {
    // core.quotePath=false still quotes a name with a double quote, but keeps its UTF-8 raw.
    expect(
      readPatchSectionPath(
        [
          'diff --git "a/中文 \\"x\\".tex" "b/中文 \\"x\\".tex"',
          '--- "a/中文 \\"x\\".tex"',
          '+++ "b/中文 \\"x\\".tex"',
          "@@ -1 +1 @@",
        ].join("\n"),
      ),
    ).toBe('中文 "x".tex');
    // Git never leaves a backslash unquoted; if one appears, it is part of the name.
    expect(
      readPatchSectionPath(
        [
          "diff --git a/odd\\344.tex b/odd\\344.tex",
          "--- a/odd\\344.tex",
          "+++ b/odd\\344.tex",
        ].join("\n"),
      ),
    ).toBe("odd\\344.tex");
  });

  it("names a section by its header, never by changed lines that look like one", () => {
    expect(
      readPatchSectionPath(
        [
          "diff --git a/notes.md b/notes.md",
          "new file mode 100644",
          "--- /dev/null",
          "+++ b/notes.md",
          "@@ -0,0 +1,2 @@",
          "++++ b/elsewhere.md",
          "+--- a/elsewhere.md",
        ].join("\n"),
      ),
    ).toBe("notes.md");
    expect(
      readPatchSectionPath(
        ["diff --git a/a b/c.tex b/a b/c.tex", "old mode 100644", "new mode 100755", ""].join("\n"),
      ),
    ).toBe("a b/c.tex");
  });
});

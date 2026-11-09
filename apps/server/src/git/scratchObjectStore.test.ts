import nodePath from "node:path";

import { describe, expect, it } from "vitest";

import {
  excludeLiteralPathspec,
  planUntrackedHashing,
  quoteAlternateObjectDirectory,
  scratchObjectStoreEnv,
} from "./scratchObjectStore.ts";

describe("scratchObjectStore", () => {
  it("leaves a plain object directory unquoted", () => {
    expect(quoteAlternateObjectDirectory("/Users/me/paper/.git/objects")).toBe(
      "/Users/me/paper/.git/objects",
    );
  });

  it("quotes a directory Git would otherwise split or unquote", () => {
    const withSeparator = `/Users/me/a${nodePath.delimiter}b/.git/objects`;
    expect(quoteAlternateObjectDirectory(withSeparator)).toBe(`"${withSeparator}"`);
    expect(quoteAlternateObjectDirectory('/tmp/"quoted"/objects')).toBe(
      '"/tmp/\\"quoted\\"/objects"',
    );
  });

  it("writes into the scratch directory and reads the repository and inherited alternates", () => {
    expect(
      scratchObjectStoreEnv({
        scratchObjectDirectory: "/tmp/scratch/objects",
        repositoryObjectDirectory: "/repo/.git/objects",
        inheritedAlternates: "/shared/objects",
      }),
    ).toEqual({
      GIT_OBJECT_DIRECTORY: "/tmp/scratch/objects",
      GIT_ALTERNATE_OBJECT_DIRECTORIES: `/repo/.git/objects${nodePath.delimiter}/shared/objects`,
    });
  });

  it("excludes files above the large-file limit and checks the rest against the budget", () => {
    const limits = { largeFileBytes: 100, hashBudgetBytes: 150 };
    expect(
      planUntrackedHashing(
        [
          { path: "notes.tex", size: 80 },
          { path: "results/run.bin", size: 8 * 1024 ** 3 },
          { path: "nested-repo/", size: null },
          { path: "figure.pdf", size: 60 },
        ],
        limits,
      ),
    ).toEqual({ kind: "hash", excludedPaths: ["results/run.bin"] });
    expect(
      planUntrackedHashing(
        [
          { path: "a.csv", size: 100 },
          { path: "b.csv", size: 100 },
        ],
        limits,
      ),
    ).toEqual({ kind: "over-budget", hashedBytes: 200 });
  });

  it("builds a literal, top-anchored exclude pathspec", () => {
    expect(excludeLiteralPathspec("data/[draft] *.bin")).toBe(
      ":(top,exclude,literal)data/[draft] *.bin",
    );
  });
});

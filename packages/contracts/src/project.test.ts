import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectSearchEntriesInput } from "./project";

const decodeSearchEntriesInput = Schema.decodeUnknownSync(ProjectSearchEntriesInput);

describe("ProjectSearchEntriesInput", () => {
  it("accepts an empty trimmed query for the composer's initial @ file list", () => {
    expect(
      decodeSearchEntriesInput({
        cwd: "/repo/project",
        query: "   ",
        kind: "file",
        limit: 80,
      }),
    ).toEqual({
      cwd: "/repo/project",
      query: "",
      kind: "file",
      limit: 80,
    });
  });
});

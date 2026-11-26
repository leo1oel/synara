import { describe, expect, it } from "vitest";

import { detailFromResult, stripAnsi } from "./providerCliOutput";

describe("stripAnsi", () => {
  it("removes colour, cursor and hyperlink escape sequences", () => {
    expect(
      stripAnsi(
        "\u001b[31mError:\u001b[39m \u001b[1;2mbad\u001b[0m\u001b[2K \u001b]8;;https://x.test\u0007link\u001b]8;;\u001b\\",
      ),
    ).toBe("Error: bad link");
  });
});

describe("detailFromResult", () => {
  it("returns coloured stderr as plain text", () => {
    expect(
      detailFromResult({
        stdout: "",
        stderr: "\u001b[31mError: ENOENT: no such file or directory, uv_cwd\u001b[39m\n",
        code: 1,
      }),
    ).toBe("Error: ENOENT: no such file or directory, uv_cwd");
  });

  it("falls through to stdout when stderr holds only escape codes", () => {
    expect(
      detailFromResult({
        stdout: "\u001b[33mnot logged in\u001b[0m",
        stderr: "\u001b[0m",
        code: 1,
      }),
    ).toBe("not logged in");
  });
});

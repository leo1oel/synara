import { describe, expect, it } from "vitest";

import { listCliInstallDirectories } from "./cliInstallDirectories";

const HOME = "/Users/test";

function fakeFileSystem(input: {
  readonly directories: ReadonlyArray<string>;
  readonly files?: Readonly<Record<string, string>>;
}) {
  const directories = new Set(input.directories);
  const files = input.files ?? {};
  return {
    homeDir: HOME,
    isDirectory: (path: string) => directories.has(path),
    readTextFile: (path: string) => files[path],
    listDirectory: (path: string) =>
      [...directories]
        .filter((entry) => entry.startsWith(`${path}/`))
        .map((entry) => entry.slice(path.length + 1).split("/")[0] ?? "")
        .filter((name, index, names) => name && names.indexOf(name) === index),
  };
}

describe("listCliInstallDirectories", () => {
  it("lists only the well-known folders that exist, in lookup order", () => {
    const fs = fakeFileSystem({
      directories: [
        "/usr/local/bin",
        "/opt/homebrew/bin",
        `${HOME}/.volta/bin`,
        `${HOME}/.claude/local`,
        `${HOME}/.local/bin`,
        `${HOME}/.unrelated/bin`,
      ],
    });

    expect(listCliInstallDirectories({ ...fs, platform: "darwin" })).toEqual([
      `${HOME}/.local/bin`,
      `${HOME}/.claude/local`,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      `${HOME}/.volta/bin`,
    ]);
  });

  it("leaves Homebrew's Apple-silicon prefix to macOS and lists nothing on Windows", () => {
    const fs = fakeFileSystem({ directories: ["/opt/homebrew/bin", "/usr/local/bin"] });
    expect(listCliInstallDirectories({ ...fs, platform: "linux" })).toEqual(["/usr/local/bin"]);
    expect(listCliInstallDirectories({ ...fs, platform: "win32" })).toEqual([]);
  });

  it("reads npm's global prefix from ~/.npmrc", () => {
    const fs = fakeFileSystem({
      directories: [`${HOME}/tools/npm/bin`],
      files: { [`${HOME}/.npmrc`]: "registry=https://registry.npmjs.org/\nprefix = ~/tools/npm\n" },
    });
    expect(listCliInstallDirectories({ ...fs, platform: "darwin" })).toEqual([
      `${HOME}/tools/npm/bin`,
    ]);
  });

  it("follows nvm's default alias to an installed version", () => {
    const versions = `${HOME}/.nvm/versions/node`;
    const fs = fakeFileSystem({
      directories: [
        `${versions}/v20.18.0/bin`,
        `${versions}/v22.11.0/bin`,
        `${versions}/v23.1.0/bin`,
      ],
      files: {
        [`${HOME}/.nvm/alias/default`]: "lts/*\n",
        [`${HOME}/.nvm/alias/lts/*`]: "lts/jod",
        [`${HOME}/.nvm/alias/lts/jod`]: "v22.11.0",
      },
    });
    expect(listCliInstallDirectories({ ...fs, platform: "darwin" })).toEqual([
      `${versions}/v22.11.0/bin`,
    ]);
  });

  it("takes the newest matching nvm version for a partial alias, else the newest installed", () => {
    const versions = `${HOME}/.nvm/versions/node`;
    const installed = [
      `${versions}/v20.9.0/bin`,
      `${versions}/v20.18.0/bin`,
      `${versions}/v22.11.0/bin`,
    ];
    const partial = fakeFileSystem({
      directories: installed,
      files: { [`${HOME}/.nvm/alias/default`]: "20" },
    });
    expect(listCliInstallDirectories({ ...partial, platform: "darwin" })).toEqual([
      `${versions}/v20.18.0/bin`,
    ]);

    const unresolved = fakeFileSystem({
      directories: installed,
      files: { [`${HOME}/.nvm/alias/default`]: "../../outside" },
    });
    expect(listCliInstallDirectories({ ...unresolved, platform: "darwin" })).toEqual([
      `${versions}/v22.11.0/bin`,
    ]);
  });
});

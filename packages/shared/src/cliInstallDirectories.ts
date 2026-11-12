// FILE: cliInstallDirectories.ts
// Purpose: The few folders agent CLIs (Claude Code, Codex) install into that the login
//          shell's non-interactive PATH often lacks, so a desktop launch still finds them.
// Layer: Shared platform runtime
// Exports: listCliInstallDirectories

import { readdirSync, readFileSync, statSync } from "node:fs";
import * as OS from "node:os";
import { join } from "node:path";

export interface CliInstallDirectoryOptions {
  readonly platform?: NodeJS.Platform;
  readonly homeDir?: string;
  /** Injectable for tests; defaults read the real filesystem. */
  readonly isDirectory?: (path: string) => boolean;
  readonly readTextFile?: (path: string) => string | undefined;
  readonly listDirectory?: (path: string) => ReadonlyArray<string>;
}

function defaultIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function defaultReadTextFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function defaultListDirectory(path: string): ReadonlyArray<string> {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function expandHome(value: string, homeDir: string): string {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return join(homeDir, value.slice(2));
  return value.replace(/^\$\{?HOME\}?(?=\/|$)/, homeDir);
}

/** `npm config set prefix <dir>` writes `prefix=<dir>` to `~/.npmrc`; globals land in `<dir>/bin`. */
function npmPrefixBin(homeDir: string, readTextFile: (path: string) => string | undefined) {
  const npmrc = readTextFile(join(homeDir, ".npmrc"));
  const line = npmrc?.split(/\r?\n/).find((entry) => /^\s*prefix\s*=/.test(entry));
  const prefix = line
    ?.slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");
  return prefix ? join(expandHome(prefix, homeDir), "bin") : undefined;
}

function compareVersionsDescending(left: string, right: string): number {
  const parts = (version: string) => version.slice(1).split(".").map(Number);
  const [a, b] = [parts(left), parts(right)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The bin of nvm's default Node: `~/.nvm/alias/default` names a version (`22`, `v22.11.0`)
 * or another alias (`lts/*` → `lts/jod` → `v22.11.0`). Without one that resolves, the newest
 * installed version. nvm itself is a shell function, so nothing outside an interactive shell
 * that sourced `nvm.sh` has this on PATH.
 */
function nvmDefaultBin(
  homeDir: string,
  readTextFile: (path: string) => string | undefined,
  listDirectory: (path: string) => ReadonlyArray<string>,
): string | undefined {
  const nvmDir = join(homeDir, ".nvm");
  const versionsDir = join(nvmDir, "versions", "node");
  const versions = listDirectory(versionsDir)
    .filter((name) => /^v\d+\.\d+\.\d+$/.test(name))
    .toSorted(compareVersionsDescending);
  const newest = versions[0];
  if (!newest) return undefined;
  let alias = readTextFile(join(nvmDir, "alias", "default"))?.trim();
  for (let hops = 0; alias && hops < 4; hops += 1) {
    const wanted = alias.replace(/^v/, "");
    if (wanted === "node" || wanted === "stable") return join(versionsDir, newest, "bin");
    if (/^\d+(\.\d+){0,2}$/.test(wanted)) {
      const match = versions.find(
        (version) => version === `v${wanted}` || version.startsWith(`v${wanted}.`),
      );
      if (match) return join(versionsDir, match, "bin");
      break;
    }
    // Alias names are nvm's own files under alias/ (`lts/jod`); never leave that folder.
    if (!/^[\w*.-]+(\/[\w*.-]+)?$/.test(alias) || alias.includes("..")) break;
    alias = readTextFile(join(nvmDir, "alias", alias))?.trim();
  }
  return join(versionsDir, newest, "bin");
}

/**
 * Existing well-known agent CLI install folders, in lookup order. A fixed list, read from
 * the filesystem only: no shell or rc file runs.
 *
 * - `~/.local/bin`: Claude Code's native installer (it only prints advice about PATH).
 * - `~/.claude/local`: Claude Code's older local install, reached through a shell alias.
 * - `/opt/homebrew/bin`: Apple-silicon Homebrew (`brew install --cask codex`), not in
 *   `/etc/paths`, so only a `brew shellenv` line in the shell's own files adds it.
 * - `/usr/local/bin`: Intel Homebrew and manual installs.
 * - npm's global prefix (`~/.npmrc`, `~/.npm-global`), bun, volta, asdf and mise shims, and
 *   nvm's default Node, which lazy or `.bashrc`-only setups leave off a login shell's PATH.
 */
export function listCliInstallDirectories(
  options: CliInstallDirectoryOptions = {},
): ReadonlyArray<string> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") return [];
  let homeDir = options.homeDir;
  if (!homeDir) {
    try {
      homeDir = OS.homedir();
    } catch {
      homeDir = undefined;
    }
  }
  const isDirectory = options.isDirectory ?? defaultIsDirectory;
  const readTextFile = options.readTextFile ?? defaultReadTextFile;
  const listDirectory = options.listDirectory ?? defaultListDirectory;
  const home = (...segments: ReadonlyArray<string>) => (homeDir ? join(homeDir, ...segments) : "");
  const candidates = [
    home(".local", "bin"),
    home(".claude", "local"),
    ...(platform === "darwin" ? ["/opt/homebrew/bin"] : []),
    "/usr/local/bin",
    homeDir ? npmPrefixBin(homeDir, readTextFile) : undefined,
    home(".npm-global", "bin"),
    home(".bun", "bin"),
    home(".volta", "bin"),
    home(".asdf", "shims"),
    home(".local", "share", "mise", "shims"),
    homeDir ? nvmDefaultBin(homeDir, readTextFile, listDirectory) : undefined,
  ];
  const seen = new Set<string>();
  const directories: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (isDirectory(candidate)) directories.push(candidate);
  }
  return directories;
}

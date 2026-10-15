#!/usr/bin/env node
// FILE: update-lockfiles.mjs
// Purpose: Regenerates the pinned npm lockfiles of the optional provider runtimes.
// Layer: Server build tooling
//
//   node apps/server/providerRuntimes/update-lockfiles.mjs
//
// A slim host (Lattice) leaves the Pi and OpenCode packages out of its bundle and
// installs them on demand from these lockfiles (src/provider/providerRuntimes.ts).
// Each runtime's package.json names its root packages; this script copies their exact
// versions from bun.lock, so the on-demand install runs the same releases the server
// is built and tested against, then asks npm for the full tree. npm leaves `integrity`
// out for packages a dependency's own shrinkwrap names (pi-coding-agent ships one), so
// those are filled in from the registry: the installer refuses any tarball it cannot
// verify. Run it after changing those packages in apps/server/package.json.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const bunLock = readFileSync(join(repoRoot, "bun.lock"), "utf8");
const RUNTIMES = ["pi", "opencode"];

function lockedVersion(name) {
  const escaped = name.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
  const match = new RegExp(`^\\s*"${escaped}": \\["${escaped}@([^"]+)"`, "m").exec(bunLock);
  if (!match) throw new Error(`bun.lock does not pin ${name}.`);
  return match[1];
}

async function registryDist(name, version) {
  const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}/${version}`);
  if (!response.ok)
    throw new Error(`Registry lookup for ${name}@${version}: HTTP ${response.status}`);
  const { dist } = await response.json();
  if (!dist?.integrity || !dist?.tarball) throw new Error(`${name}@${version} has no integrity.`);
  return dist;
}

const npmCache = mkdtempSync(join(tmpdir(), "synara-runtime-npm-"));
try {
  for (const runtime of RUNTIMES) {
    const directory = join(here, runtime);
    const manifestPath = join(directory, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const name of Object.keys(manifest.dependencies)) {
      manifest.dependencies[name] = lockedVersion(name);
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    rmSync(join(directory, "package-lock.json"), { force: true });
    execFileSync(
      "npm",
      ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: directory, stdio: "inherit", env: { ...process.env, npm_config_cache: npmCache } },
    );
    const lockPath = join(directory, "package-lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path || entry.integrity) continue;
      const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      const dist = await registryDist(name, entry.version);
      entry.resolved = dist.tarball;
      entry.integrity = dist.integrity;
    }
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    console.log(
      `Locked the ${runtime} runtime: ${Object.keys(lock.packages).length - 1} packages.`,
    );
  }
} finally {
  rmSync(npmCache, { recursive: true, force: true });
}

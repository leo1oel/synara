// FILE: providerRuntimes.ts
// Purpose: Loads the Pi and OpenCode provider packages, from the server's own install
//   or, when a slim host leaves them out of its bundle, from an on-demand install.
// Layer: Provider infrastructure
// Exports: runtime availability, module loading, and the integrity-checked installer.
//
// Synara itself still depends on these packages, so a development checkout or a full
// install loads them exactly as before. Lattice ships without them (they and their
// trees were most of its bundled runtime) and installs one only when the user picks
// that provider: every tarball named by the runtime's committed npm lockfile
// (../../providerRuntimes/<id>/package-lock.json) is downloaded, checked against the
// lockfile's integrity hash, unpacked into `<baseDir>/provider-runtimes/<id>/<lock>`,
// and loaded through a generated entry module there. Nothing is fetched afterwards,
// so an installed provider keeps working offline. Package lifecycle scripts are not
// run: none of these trees needs one at runtime (their native parts ship as
// per-platform optional packages), and the install verifies that every entry the
// server imports loads before it is kept.

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

import openCodeLock from "../../providerRuntimes/opencode/package-lock.json" with { type: "json" };
import piLock from "../../providerRuntimes/pi/package-lock.json" with { type: "json" };

export type ProviderRuntimeId = "pi" | "opencode";

/** The modules the server imports from each runtime, and their types. */
export interface ProviderRuntimeModules {
  readonly "@earendil-works/pi-coding-agent": typeof import("@earendil-works/pi-coding-agent");
  readonly "@earendil-works/pi-ai/compat": typeof import("@earendil-works/pi-ai/compat");
  readonly "@earendil-works/pi-ai/providers/openrouter": typeof import("@earendil-works/pi-ai/providers/openrouter");
  readonly "@earendil-works/pi-ai/providers/opencode": typeof import("@earendil-works/pi-ai/providers/opencode");
  readonly "@opencode/client": typeof import("@opencode/client");
  readonly "@opencode-ai/sdk/v2": typeof import("@opencode-ai/sdk/v2");
}
type ProviderRuntimeSpecifier = keyof ProviderRuntimeModules;

interface LockfileEntry {
  readonly version?: string;
  readonly resolved?: string;
  readonly integrity?: string;
  readonly dev?: boolean;
  readonly inBundle?: boolean;
  readonly link?: boolean;
  readonly os?: ReadonlyArray<string>;
  readonly cpu?: ReadonlyArray<string>;
}
interface Lockfile {
  readonly packages: Readonly<Record<string, LockfileEntry>>;
}

// Literal imports, so a full install resolves them like any other dependency.
const RUNTIMES: Record<
  ProviderRuntimeId,
  {
    readonly displayName: string;
    readonly lock: Lockfile;
    readonly modules: Partial<Record<ProviderRuntimeSpecifier, () => Promise<unknown>>>;
  }
> = {
  pi: {
    displayName: "Pi",
    lock: piLock as Lockfile,
    modules: {
      "@earendil-works/pi-coding-agent": () => import("@earendil-works/pi-coding-agent"),
      "@earendil-works/pi-ai/compat": () => import("@earendil-works/pi-ai/compat"),
      "@earendil-works/pi-ai/providers/openrouter": () =>
        import("@earendil-works/pi-ai/providers/openrouter"),
      "@earendil-works/pi-ai/providers/opencode": () =>
        import("@earendil-works/pi-ai/providers/opencode"),
    },
  },
  opencode: {
    displayName: "OpenCode",
    lock: openCodeLock as Lockfile,
    modules: {
      "@opencode/client": () => import("@opencode/client"),
      "@opencode-ai/sdk/v2": () => import("@opencode-ai/sdk/v2"),
    },
  },
};

const MARKER_FILE = ".synara-runtime.json";
const ENTRY_FILE = "index.mjs";
const STAGING_PREFIX = ".staging-";
const DOWNLOAD_CONCURRENCY = 6;
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const VERIFY_TIMEOUT_MS = 120_000;
const PROGRESS_INTERVAL_MS = 200;

export function providerRuntimeIdForDriver(driver: string): ProviderRuntimeId | null {
  return driver === "pi" || driver === "opencode" ? driver : null;
}

function runtimeOf(specifier: ProviderRuntimeSpecifier): ProviderRuntimeId {
  return specifier.startsWith("@earendil-works/") ? "pi" : "opencode";
}

const lockHashes = new Map<ProviderRuntimeId, string>();
function lockHash(id: ProviderRuntimeId): string {
  let hash = lockHashes.get(id);
  if (!hash) {
    hash = createHash("sha256")
      .update(JSON.stringify(RUNTIMES[id].lock))
      .digest("hex")
      .slice(0, 16);
    lockHashes.set(id, hash);
  }
  return hash;
}

/** The packages behind a runtime's module specifiers ("@scope/name/sub" -> "@scope/name"). */
function rootPackageNames(id: ProviderRuntimeId): string[] {
  const names = Object.keys(RUNTIMES[id].modules).map((specifier) =>
    specifier.split("/").slice(0, 2).join("/"),
  );
  return [...new Set(names)];
}

let installRoot: string | null = null;

/** Called once the server knows its base directory; installs live beside its state. */
export function configureProviderRuntimes(input: { readonly baseDir: string }): void {
  installRoot = path.join(input.baseDir, "provider-runtimes");
}

function installDirectory(id: ProviderRuntimeId): string | null {
  return installRoot ? path.join(installRoot, id, lockHash(id)) : null;
}

// Whether the server's own install has the packages; it cannot change while it runs.
const bundled = new Map<ProviderRuntimeId, boolean>();
function isBundled(id: ProviderRuntimeId): boolean {
  let result = bundled.get(id);
  if (result === undefined) {
    result = findBundledPackages(rootPackageNames(id));
    bundled.set(id, result);
  }
  return result;
}

/**
 * The server's own node_modules, found the way Node resolves a bare specifier: walk up
 * from this module. A full install (or a development checkout) has the packages there.
 */
function findBundledPackages(names: ReadonlyArray<string>): boolean {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const modules = path.join(directory, "node_modules");
    if (names.every((name) => existsSync(path.join(modules, name, "package.json")))) return true;
    const parent = path.dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

function isInstalled(id: ProviderRuntimeId): boolean {
  const directory = installDirectory(id);
  if (!directory) return false;
  try {
    const marker = JSON.parse(readFileSync(path.join(directory, MARKER_FILE), "utf8"));
    return marker?.lockHash === lockHash(id);
  } catch {
    return false;
  }
}

export type ProviderRuntimeAvailability = "bundled" | "installed" | "missing";

export function providerRuntimeAvailability(id: ProviderRuntimeId): ProviderRuntimeAvailability {
  if (isBundled(id)) return "bundled";
  return isInstalled(id) ? "installed" : "missing";
}

export class ProviderRuntimeMissingError extends Error {
  readonly runtime: ProviderRuntimeId;
  constructor(runtime: ProviderRuntimeId) {
    const name = RUNTIMES[runtime].displayName;
    super(`${name} is not installed. Install ${name} in provider settings to use it.`);
    this.name = "ProviderRuntimeMissingError";
    this.runtime = runtime;
  }
}

type RuntimeEntry = { readonly load: (specifier: string) => Promise<unknown> };
const entryModules = new Map<string, Promise<RuntimeEntry>>();
const loadedModules = new Map<ProviderRuntimeSpecifier, unknown>();

/**
 * Imports one provider module. Rejects with `ProviderRuntimeMissingError` while the
 * runtime is neither part of the server's install nor installed on demand. Failures are
 * not memoized, so a provider works as soon as its install completes.
 */
export async function loadProviderRuntimeModule<S extends ProviderRuntimeSpecifier>(
  specifier: S,
): Promise<ProviderRuntimeModules[S]> {
  const loaded = loadedModules.get(specifier);
  if (loaded) return loaded as ProviderRuntimeModules[S];
  const id = runtimeOf(specifier);
  let module: unknown;
  if (isBundled(id)) {
    module = await RUNTIMES[id].modules[specifier]!();
  } else {
    const directory = installDirectory(id);
    if (!directory || !isInstalled(id)) throw new ProviderRuntimeMissingError(id);
    const entryUrl = pathToFileURL(path.join(directory, ENTRY_FILE)).href;
    let entry = entryModules.get(entryUrl);
    if (!entry) {
      entry = import(entryUrl) as Promise<RuntimeEntry>;
      entryModules.set(entryUrl, entry);
    }
    module = await (await entry).load(specifier);
  }
  loadedModules.set(specifier, module);
  return module as ProviderRuntimeModules[S];
}

/** The module, once a `loadProviderRuntimeModule` call for it has resolved. */
export function loadedProviderRuntimeModule<S extends ProviderRuntimeSpecifier>(
  specifier: S,
): ProviderRuntimeModules[S] {
  const loaded = loadedProviderRuntimeModuleIfAny(specifier);
  if (!loaded) throw new ProviderRuntimeMissingError(runtimeOf(specifier));
  return loaded;
}

export function loadedProviderRuntimeModuleIfAny<S extends ProviderRuntimeSpecifier>(
  specifier: S,
): ProviderRuntimeModules[S] | undefined {
  return loadedModules.get(specifier) as ProviderRuntimeModules[S] | undefined;
}

// ---------------------------------------------------------------------------
// Installer

export type ProviderRuntimeInstallFailure =
  | "offline"
  | "download"
  | "integrity"
  | "disk"
  | "verify";

export class ProviderRuntimeInstallError extends Error {
  readonly failure: ProviderRuntimeInstallFailure;
  constructor(failure: ProviderRuntimeInstallFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProviderRuntimeInstallError";
    this.failure = failure;
  }
}

const OFFLINE_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "EPIPE",
]);
const DISK_CODES = new Set(["ENOSPC", "EACCES", "EPERM", "EROFS", "EDQUOT", "EMFILE"]);

function classifyInstallError(error: unknown): ProviderRuntimeInstallError {
  if (error instanceof ProviderRuntimeInstallError) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? "";
  const message = error instanceof Error ? error.message : String(error);
  if (OFFLINE_CODES.has(code) || code.startsWith("ERR_PROXY")) {
    return new ProviderRuntimeInstallError("offline", message, { cause: error });
  }
  if (DISK_CODES.has(code))
    return new ProviderRuntimeInstallError("disk", message, { cause: error });
  return new ProviderRuntimeInstallError("download", message, { cause: error });
}

// Node's fetch ignores HTTP(S)_PROXY; its http(s) agents honor them through `proxyEnv`
// (Node 24.5+), and the host passes the system proxy in exactly those variables.
const agents = {
  "http:": new http.Agent({ keepAlive: true, proxyEnv: process.env } as http.AgentOptions),
  "https:": new https.Agent({ keepAlive: true, proxyEnv: process.env } as https.AgentOptions),
};

function tarballUrl(resolved: string): string {
  // A mirror serves the same tarballs; the lockfile's integrity still decides.
  const registry = process.env.SYNARA_PROVIDER_RUNTIME_REGISTRY?.trim();
  if (!registry) return resolved;
  const url = new URL(resolved);
  return new URL(
    url.pathname.replace(/^\//, ""),
    registry.endsWith("/") ? registry : `${registry}/`,
  ).href;
}

function download(url: string, redirects = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "http:" ? http : https;
    const request = client.get(
      target,
      {
        agent: agents[target.protocol as keyof typeof agents],
        timeout: DOWNLOAD_TIMEOUT_MS,
        headers: { "user-agent": "synara-provider-runtime" },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location && redirects < 5) {
          response.resume();
          resolve(download(new URL(response.headers.location, target).href, redirects + 1));
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(
            new ProviderRuntimeInstallError("download", `HTTP ${status} from ${target.host}.`),
          );
          return;
        }
        // A connection lost mid-body is an incomplete download, not an unreachable host.
        const interrupted = () =>
          reject(new ProviderRuntimeInstallError("download", "The download was interrupted."));
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          response.complete ? resolve(Buffer.concat(chunks)) : interrupted(),
        );
        response.on("error", interrupted);
      },
    );
    request.on("timeout", () =>
      request.destroy(Object.assign(new Error("The download timed out."), { code: "ETIMEDOUT" })),
    );
    request.on("error", reject);
  });
}

function verifyIntegrity(bytes: Buffer, integrity: string, label: string): void {
  // Standard subresource-integrity strings; npm records sha512 (sha1 only for ancient
  // packages, which these trees do not contain), so require the strongest it lists.
  const expected = integrity
    .split(/\s+/)
    .map((token) => /^(sha512|sha384|sha256)-(.+)$/.exec(token))
    .filter((match): match is RegExpExecArray => match !== null)
    .toSorted((left, right) => right[1]!.localeCompare(left[1]!))[0];
  if (!expected) {
    throw new ProviderRuntimeInstallError("integrity", `${label} has no usable integrity hash.`);
  }
  const actual = createHash(expected[1]!).update(bytes).digest("base64");
  if (actual !== expected[2]) {
    throw new ProviderRuntimeInstallError("integrity", `${label} failed its integrity check.`);
  }
}

function readString(block: Buffer, offset: number, length: number): string {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function readSize(block: Buffer): number {
  // Sizes beyond 8 GiB use GNU base-256; no package comes close, but parse it anyway.
  if ((block[124]! & 0x80) !== 0) {
    let size = 0;
    for (let index = 125; index < 136; index += 1) size = size * 256 + block[index]!;
    return size;
  }
  return Number.parseInt(readString(block, 124, 12).trim() || "0", 8);
}

function paxPath(body: Buffer): string | undefined {
  let offset = 0;
  let found: string | undefined;
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(body.subarray(offset, space).toString("utf8"), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = body.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (record.slice(0, equals) === "path") found = record.slice(equals + 1);
    offset += length;
  }
  return found;
}

// Source maps and type declarations are never loaded at runtime (the server does not
// run with --enable-source-maps) and are over a third of Pi's unpacked bytes.
const UNLOADED_FILE = /\.(?:map|d\.[cm]?ts)$/;

/**
 * Unpacks an npm package tarball the way npm does: regular files and directories only
 * (links and devices are skipped), the leading `package/` segment removed, and nothing
 * allowed to land outside `destination`. Integrity covers the whole tarball, so leaving
 * out files that nothing loads does not weaken it.
 */
async function extractPackage(tarball: Buffer, destination: string, label: string): Promise<void> {
  let archive: Buffer;
  try {
    archive = gunzipSync(tarball);
  } catch (error) {
    throw new ProviderRuntimeInstallError("integrity", `${label} is not a valid package archive.`, {
      cause: error,
    });
  }
  const root = path.resolve(destination);
  let offset = 0;
  let longName: string | undefined;
  let extendedName: string | undefined;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = readSize(header);
    const type = String.fromCharCode(header[156]!);
    const body = archive.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      extendedName = paxPath(body);
      continue;
    }
    if (type === "g") continue;
    if (type === "L") {
      longName = readString(body, 0, body.length);
      continue;
    }
    const prefix = readString(header, 257, 6).startsWith("ustar")
      ? readString(header, 345, 155)
      : "";
    const name =
      extendedName ??
      longName ??
      (prefix ? `${prefix}/${readString(header, 0, 100)}` : readString(header, 0, 100));
    extendedName = undefined;
    longName = undefined;
    if (type !== "0" && type !== "\0" && type !== "7" && type !== "5") continue;
    const segments = name
      .split(/[\\/]+/)
      .filter((segment) => segment && segment !== ".")
      .slice(1);
    if (segments.length === 0) continue;
    const target = path.resolve(root, ...segments);
    if (segments.includes("..") || !target.startsWith(root + path.sep)) {
      throw new ProviderRuntimeInstallError("integrity", `${label} contains an unsafe path.`);
    }
    if (type === "5") {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    if (UNLOADED_FILE.test(target)) continue;
    const mode = Number.parseInt(readString(header, 100, 8).trim() || "644", 8);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body, { mode: (mode & 0o111) !== 0 ? 0o755 : 0o644 });
  }
}

// npm's `os`/`cpu` fields: an allowlist, a `!`-prefixed blocklist, or both.
function platformMatches(allowed: ReadonlyArray<string> | undefined, value: string): boolean {
  if (!allowed) return true;
  const included = allowed.filter((item) => !item.startsWith("!"));
  return (included.length === 0 || included.includes(value)) && !allowed.includes(`!${value}`);
}

function platformEntries(id: ProviderRuntimeId) {
  return Object.entries(RUNTIMES[id].lock.packages).filter(
    ([entryPath, entry]) =>
      entryPath.startsWith("node_modules/") &&
      !entry.dev &&
      !entry.inBundle &&
      !entry.link &&
      platformMatches(entry.os, process.platform) &&
      platformMatches(entry.cpu, process.arch),
  );
}

async function mapConcurrently<T>(
  items: ReadonlyArray<T>,
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failure: unknown;
  const worker = async () => {
    while (failure === undefined && next < items.length) {
      const item = items[next]!;
      next += 1;
      try {
        await run(item);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure !== undefined) throw failure;
}

// A fresh Node process imports every module the server needs from the staged tree, so
// an incomplete or incompatible install is rejected before it replaces anything.
function verifyStagedRuntime(id: ProviderRuntimeId, staging: string): Promise<void> {
  const script = [
    `const entry = await import(${JSON.stringify(pathToFileURL(path.join(staging, ENTRY_FILE)).href)});`,
    `for (const specifier of ${JSON.stringify(Object.keys(RUNTIMES[id].modules))}) await entry.load(specifier);`,
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      cwd: staging,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "ignore", "pipe"],
      timeout: VERIFY_TIMEOUT_MS,
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-2_000);
    });
    child.on("error", (error) =>
      reject(new ProviderRuntimeInstallError("verify", error.message, { cause: error })),
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new ProviderRuntimeInstallError(
            "verify",
            `The installed packages did not load (exit ${code ?? "signal"}). ${stderr.trim()}`.trim(),
          ),
        );
      }
    });
  });
}

async function performInstall(
  id: ProviderRuntimeId,
  onProgress: (completed: number, total: number) => void,
): Promise<void> {
  const directory = installDirectory(id);
  if (!directory) {
    throw new ProviderRuntimeInstallError(
      "disk",
      "The server has no data directory for provider installs.",
    );
  }
  const runtimeRoot = path.dirname(directory);
  await fs.mkdir(runtimeRoot, { recursive: true });
  // Leftovers of an interrupted install never become an installed runtime: the marker is
  // written only inside a staging directory that has passed verification.
  for (const entry of await fs.readdir(runtimeRoot)) {
    if (entry.startsWith(STAGING_PREFIX)) {
      await fs.rm(path.join(runtimeRoot, entry), { recursive: true, force: true });
    }
  }
  const staging = path.join(runtimeRoot, `${STAGING_PREFIX}${randomBytes(6).toString("hex")}`);
  await fs.mkdir(staging);
  try {
    const entries = platformEntries(id);
    let completed = 0;
    onProgress(completed, entries.length);
    await mapConcurrently(entries, DOWNLOAD_CONCURRENCY, async ([entryPath, entry]) => {
      const label = `${entryPath.slice(entryPath.lastIndexOf("node_modules/") + 13)}@${entry.version}`;
      if (!entry.resolved || !entry.integrity) {
        throw new ProviderRuntimeInstallError("integrity", `${label} has no pinned tarball.`);
      }
      let tarball: Buffer | undefined;
      for (let attempt = 1; tarball === undefined; attempt += 1) {
        try {
          tarball = await download(tarballUrl(entry.resolved));
        } catch (error) {
          const classified = classifyInstallError(error);
          if (attempt >= DOWNLOAD_ATTEMPTS || classified.failure === "disk") throw classified;
        }
      }
      verifyIntegrity(tarball, entry.integrity, label);
      await extractPackage(tarball, path.join(staging, entryPath), label);
      completed += 1;
      onProgress(completed, entries.length);
    });
    await fs.writeFile(
      path.join(staging, ENTRY_FILE),
      "// Generated by Synara: provider modules resolve from this directory's node_modules.\n" +
        "export const load = (specifier) => import(specifier);\n",
    );
    await verifyStagedRuntime(id, staging);
    await fs.writeFile(
      path.join(staging, MARKER_FILE),
      `${JSON.stringify({ runtime: id, lockHash: lockHash(id), installedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rename(staging, directory);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw classifyInstallError(error);
  }
  // Installs for an older lockfile are never loaded again.
  for (const entry of await fs.readdir(runtimeRoot)) {
    if (entry !== path.basename(directory) && !entry.startsWith(STAGING_PREFIX)) {
      await fs
        .rm(path.join(runtimeRoot, entry), { recursive: true, force: true })
        .catch(() => undefined);
    }
  }
}

export type ProviderRuntimeInstallState =
  | { readonly status: "installing"; readonly completed: number; readonly total: number }
  | {
      readonly status: "failed";
      readonly failure: ProviderRuntimeInstallFailure;
      readonly message: string;
    };

const installStates = new Map<ProviderRuntimeId, ProviderRuntimeInstallState>();
const activeInstalls = new Map<ProviderRuntimeId, Promise<boolean>>();
const listeners = new Set<(id: ProviderRuntimeId, finished: boolean) => void>();

export function providerRuntimeInstallState(
  id: ProviderRuntimeId,
): ProviderRuntimeInstallState | null {
  return installStates.get(id) ?? null;
}

/** Notified on install progress, and once more (`finished`) when an install settles. */
export function subscribeProviderRuntimeChanges(
  listener: (id: ProviderRuntimeId, finished: boolean) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(id: ProviderRuntimeId, finished: boolean) {
  for (const listener of listeners) listener(id, finished);
}

/**
 * Starts installing a runtime, or joins the install already running. Resolves to whether
 * it succeeded; a failure is reported through `providerRuntimeInstallState`.
 */
export function requestProviderRuntimeInstall(id: ProviderRuntimeId): Promise<boolean> {
  const active = activeInstalls.get(id);
  if (active) return active;
  // Reported before the first await, so the request's reply already shows the install.
  installStates.set(id, { status: "installing", completed: 0, total: platformEntries(id).length });
  notify(id, false);
  let lastNotified = 0;
  const install = performInstall(id, (completed, total) => {
    installStates.set(id, { status: "installing", completed, total });
    const now = Date.now();
    if (now - lastNotified >= PROGRESS_INTERVAL_MS || completed === total) {
      lastNotified = now;
      notify(id, false);
    }
  }).then(
    () => {
      installStates.delete(id);
      return true;
    },
    (error: unknown) => {
      const classified = classifyInstallError(error);
      installStates.set(id, {
        status: "failed",
        failure: classified.failure,
        message: classified.message.slice(0, 2_000) || "The install did not complete.",
      });
      return false;
    },
  );
  const tracked = install.finally(() => {
    activeInstalls.delete(id);
    notify(id, true);
  });
  activeInstalls.set(id, tracked);
  return tracked;
}

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import type { SynaraStorageSnapshot } from "@synara/contracts";

/**
 * Durable copy of the embedded panel's browser storage.
 *
 * Lattice serves its window from `tauri://localhost` and this server's page
 * from `http://127.0.0.1:<port>`, so every Synara frame inside Lattice is
 * third-party to its host. WebKit partitions a third-party frame's
 * localStorage and does not keep it across launches, so each Lattice quit
 * forgot every local-only setting (default provider, sticky model and effort,
 * hidden and ordered providers) and every unsent draft. Standalone Synara
 * keeps the same keys in first-party storage and never calls this.
 *
 * The page mirrors its canonical keys here and imports them before any store
 * hydrates (apps/web/src/latticeEmbedStorage.ts). The file holds opaque
 * strings: nothing here knows any store's shape, so a store added or migrated
 * upstream is covered without a change on either side of the frame.
 *
 * Every Synara frame in one Lattice window (agent panel, Git drawer, settings)
 * shares that partitioned storage and mirrors it independently, so the same
 * change can arrive several times and out of order. Each write carries the
 * time its frame read the storage; a key keeps the newest reading, and a
 * removal is held as a tombstone so a late, older write cannot resurrect it.
 */

export const LATTICE_EMBED_STORAGE_FILE = "lattice-embed-storage.json";

// The same bounds the desktop origin migration applies to a snapshot it imports
// (apps/web/src/storageOriginMigration.ts), so whatever is accepted here can be
// imported there.
export const LATTICE_EMBED_STORAGE_MAX_ENTRIES = 2_048;
export const LATTICE_EMBED_STORAGE_MAX_KEY_LENGTH = 512;
export const LATTICE_EMBED_STORAGE_MAX_BYTES = 16 * 1024 * 1024;

export function isCanonicalSynaraStorageKey(key: string): boolean {
  return (
    (key.startsWith("synara:") || key.startsWith("synara.")) &&
    key.length <= LATTICE_EMBED_STORAGE_MAX_KEY_LENGTH
  );
}

/** One mirror pass from a frame: the keys that changed since its last accepted pass. */
export interface LatticeEmbedStorageUpdate {
  readonly version: 1;
  /** Epoch milliseconds at which the frame read these values from its storage. */
  readonly observedAt: number;
  readonly set: Readonly<Record<string, string>>;
  readonly remove: ReadonlyArray<string>;
}

interface StoredEntry {
  /** null is a removal, kept so an older write cannot bring the key back. */
  readonly value: string | null;
  readonly observedAt: number;
}

interface StoredFile {
  readonly version: 1;
  readonly entries: Record<string, StoredEntry>;
}

export type LatticeEmbedStorageWriteResult = "ok" | "too-large";

function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function parseLatticeEmbedStorageUpdate(value: unknown): LatticeEmbedStorageUpdate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    typeof candidate.observedAt !== "number" ||
    !Number.isSafeInteger(candidate.observedAt) ||
    candidate.observedAt < 0 ||
    !candidate.set ||
    typeof candidate.set !== "object" ||
    Array.isArray(candidate.set) ||
    !Array.isArray(candidate.remove)
  ) {
    return null;
  }
  const set = candidate.set as Record<string, unknown>;
  const setKeys = Object.keys(set);
  if (setKeys.length + candidate.remove.length > LATTICE_EMBED_STORAGE_MAX_ENTRIES) return null;
  for (const key of setKeys) {
    if (!isCanonicalSynaraStorageKey(key) || typeof set[key] !== "string") return null;
  }
  for (const key of candidate.remove) {
    if (typeof key !== "string" || !isCanonicalSynaraStorageKey(key) || key in set) return null;
  }
  return {
    version: 1,
    observedAt: candidate.observedAt,
    set: set as Record<string, string>,
    remove: candidate.remove as string[],
  };
}

function parseStoredFile(value: unknown): Map<string, StoredEntry> {
  const entries = new Map<string, StoredEntry>();
  if (!value || typeof value !== "object") return entries;
  const file = value as Partial<StoredFile>;
  if (file.version !== 1 || !file.entries || typeof file.entries !== "object") return entries;
  for (const [key, entry] of Object.entries(file.entries)) {
    if (
      isCanonicalSynaraStorageKey(key) &&
      entry &&
      typeof entry === "object" &&
      (typeof entry.value === "string" || entry.value === null) &&
      Number.isSafeInteger(entry.observedAt)
    ) {
      entries.set(key, { value: entry.value, observedAt: entry.observedAt });
    }
  }
  return entries;
}

export interface LatticeEmbedStore {
  readonly snapshot: () => Promise<SynaraStorageSnapshot>;
  readonly apply: (update: LatticeEmbedStorageUpdate) => Promise<LatticeEmbedStorageWriteResult>;
}

/**
 * One store per file. Reads and writes are serialized through one chain, so
 * concurrent passes from sibling frames cannot interleave a read-modify-write
 * or race two renames.
 */
export function makeLatticeEmbedStore(filePath: string): LatticeEmbedStore {
  let entries: Map<string, StoredEntry> | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };

  const load = async (): Promise<Map<string, StoredEntry>> => {
    if (entries) return entries;
    try {
      entries = parseStoredFile(JSON.parse(await fs.readFile(filePath, "utf8")) as unknown);
    } catch {
      // Missing or unreadable: start empty. The next accepted write replaces it.
      entries = new Map();
    }
    return entries;
  };

  const persist = async (next: Map<string, StoredEntry>): Promise<void> => {
    const directory = nodePath.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });
    const tempPath = nodePath.join(
      directory,
      `.${nodePath.basename(filePath)}.tmp-${process.pid}-${randomUUID()}`,
    );
    const file: StoredFile = { version: 1, entries: Object.fromEntries(next) };
    try {
      await fs.writeFile(tempPath, JSON.stringify(file), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await fs.rename(tempPath, filePath);
    } catch (cause) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw cause;
    }
  };

  return {
    snapshot: () =>
      serialized(async () => {
        const current = await load();
        const live: Record<string, string> = {};
        for (const [key, entry] of current) {
          if (entry.value !== null) live[key] = entry.value;
        }
        return { version: 1, exportedAt: new Date().toISOString(), entries: live };
      }),
    apply: (update) =>
      serialized(async () => {
        const current = await load();
        const next = new Map(current);
        let changed = false;
        const accept = (key: string, value: string | null) => {
          const existing = next.get(key);
          if (existing && existing.observedAt > update.observedAt) return;
          if (existing?.value === value) return;
          next.set(key, { value, observedAt: update.observedAt });
          changed = true;
        };
        for (const [key, value] of Object.entries(update.set)) accept(key, value);
        for (const key of update.remove) accept(key, null);
        if (!changed) return "ok";

        let liveCount = 0;
        let liveBytes = 0;
        for (const [key, entry] of next) {
          if (entry.value === null) continue;
          liveCount += 1;
          liveBytes += utf8Length(key) + utf8Length(entry.value);
        }
        if (
          liveCount > LATTICE_EMBED_STORAGE_MAX_ENTRIES ||
          liveBytes > LATTICE_EMBED_STORAGE_MAX_BYTES
        ) {
          return "too-large";
        }
        // A tombstone only has to outlast the writes in flight when it landed;
        // keep the newest ones so per-thread keys cannot grow the file forever.
        const tombstones = [...next].filter(([, entry]) => entry.value === null);
        if (tombstones.length > LATTICE_EMBED_STORAGE_MAX_ENTRIES) {
          tombstones.sort(([, a], [, b]) => a.observedAt - b.observedAt);
          for (const [key] of tombstones.slice(
            0,
            tombstones.length - LATTICE_EMBED_STORAGE_MAX_ENTRIES,
          )) {
            next.delete(key);
          }
        }
        await persist(next);
        entries = next;
        return "ok";
      }),
  };
}

const stores = new Map<string, LatticeEmbedStore>();

/** The process-wide store for a state directory. */
export function latticeEmbedStoreFor(stateDir: string): LatticeEmbedStore {
  const filePath = nodePath.join(stateDir, LATTICE_EMBED_STORAGE_FILE);
  let store = stores.get(filePath);
  if (!store) {
    store = makeLatticeEmbedStore(filePath);
    stores.set(filePath, store);
  }
  return store;
}

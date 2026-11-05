// FILE: latticeEmbedStorage.ts
// Purpose: Keeps the Lattice embed's localStorage across Lattice launches, through the server.

import type { SynaraStorageSnapshot } from "@synara/contracts";

import { readEmbeddedHostAuthToken, isLatticeEmbedDocument } from "./embedMode";
import {
  importSynaraStorageSnapshot,
  isCanonicalStorageKey,
  MAX_SNAPSHOT_KEY_LENGTH,
} from "./storageOriginMigration";

/**
 * Inside Lattice this page is a third-party frame (tauri://localhost hosts
 * http://127.0.0.1:<port>), and WebKit gives such a frame partitioned
 * localStorage that does not survive the app quitting. Every store here
 * persists to localStorage, so each launch used to start from defaults:
 * default provider, sticky model and effort, hidden and ordered providers,
 * unsent drafts, and every other local-only preference.
 *
 * The server keeps a durable copy of every canonical key
 * (apps/server/src/agentGateway/latticeEmbedStorage.ts). Before any store
 * module loads, `restoreLatticeEmbedStorage` imports that copy into keys this
 * session has not written yet, then mirrors changes back by comparing the
 * storage with what the server last accepted. Comparing instead of wrapping
 * `Storage` keeps every store, and every key a later upstream merge adds,
 * covered without touching how they write.
 *
 * Standalone Synara never runs this: it is gated on Lattice's handshake.
 */

export const LATTICE_EMBED_STORAGE_PATH = "/api/lattice/embed-storage";
// Lattice quits by stopping this server, so a write still waiting when it goes
// is lost; the interval bounds that window. A store's own debounce adds to it.
const MIRROR_INTERVAL_MS = 1_000;
// After the server refuses a pass outright, retry it rarely rather than resend
// the same rejected body every second.
const REJECTED_RETRY_MS = 30_000;
// The boot waits on this read; past it the panel opens with defaults instead.
const RESTORE_TIMEOUT_MS = 3_000;
// The keepalive budget browsers share across a document's pending requests.
const KEEPALIVE_MAX_BODY_BYTES = 60 * 1024;

type Fetch = typeof fetch;

export interface LatticeEmbedStorageOptions {
  readonly storage: Storage;
  readonly token: string;
  readonly origin: string;
  readonly fetch?: Fetch;
  readonly now?: () => number;
  readonly intervalMs?: number;
}

interface MirrorUpdate {
  readonly version: 1;
  readonly observedAt: number;
  readonly set: Record<string, string>;
  readonly remove: string[];
}

function readCanonicalEntries(storage: Storage): Map<string, string> {
  const entries = new Map<string, string>();
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    // The server takes only what the origin migration would import back.
    if (key === null || !isCanonicalStorageKey(key) || key.length > MAX_SNAPSHOT_KEY_LENGTH)
      continue;
    const value = storage.getItem(key);
    if (value !== null) entries.set(key, value);
  }
  return entries;
}

/** The keys whose value in `storage` differs from what the server last accepted. */
export function diffLatticeEmbedStorage(
  synced: ReadonlyMap<string, string>,
  storage: Storage,
): { set: Record<string, string>; remove: string[] } | null {
  const current = readCanonicalEntries(storage);
  const set: Record<string, string> = {};
  const remove: string[] = [];
  for (const [key, value] of current) {
    if (synced.get(key) !== value) set[key] = value;
  }
  for (const key of synced.keys()) {
    if (!current.has(key)) remove.push(key);
  }
  return Object.keys(set).length > 0 || remove.length > 0 ? { set, remove } : null;
}

function endpoint(origin: string): string {
  return new URL(LATTICE_EMBED_STORAGE_PATH, origin).toString();
}

async function fetchSnapshot(options: LatticeEmbedStorageOptions): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESTORE_TIMEOUT_MS);
  try {
    const response = await (options.fetch ?? fetch)(endpoint(options.origin), {
      headers: { Authorization: `Bearer ${options.token}` },
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok ? ((await response.json()) as unknown) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function readSnapshot(value: unknown): SynaraStorageSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<SynaraStorageSnapshot>;
  return candidate.version === 1 &&
    typeof candidate.exportedAt === "string" &&
    candidate.entries !== null &&
    typeof candidate.entries === "object" &&
    !Array.isArray(candidate.entries)
    ? (candidate as SynaraStorageSnapshot)
    : null;
}

/** Starts mirroring; `synced` is what the server holds now. Returns a stop function. */
export function startLatticeEmbedStorageMirror(
  options: LatticeEmbedStorageOptions,
  synced: Map<string, string>,
): () => void {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let inFlight = false;
  let retryAfter = 0;
  let stopped = false;

  const pass = (keepalive: boolean): void => {
    if (stopped || inFlight || now() < retryAfter) return;
    const diff = diffLatticeEmbedStorage(synced, options.storage);
    if (!diff) return;
    const update: MirrorUpdate = { version: 1, observedAt: now(), ...diff };
    const body = JSON.stringify(update);
    inFlight = true;
    void doFetch(endpoint(options.origin), {
      method: "POST",
      headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
      body,
      keepalive: keepalive && body.length <= KEEPALIVE_MAX_BODY_BYTES,
    })
      .then((response) => {
        if (response.ok) {
          for (const [key, value] of Object.entries(update.set)) synced.set(key, value);
          for (const key of update.remove) synced.delete(key);
          retryAfter = 0;
        } else if (response.status >= 400 && response.status < 500) {
          retryAfter = now() + REJECTED_RETRY_MS;
        }
      })
      // The sidecar restarting within a session: the next pass resends.
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
      });
  };

  const interval = setInterval(() => pass(false), options.intervalMs ?? MIRROR_INTERVAL_MS);
  const onPageHide = () => pass(true);
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") pass(true);
  };
  if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  pass(false);

  return () => {
    stopped = true;
    clearInterval(interval);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

/**
 * Imports the server's copy, then starts the mirror. Without a usable copy it
 * does neither: mirroring from a storage the copy never reached would replace
 * the writer's saved settings with this launch's defaults.
 */
export async function restoreLatticeEmbedStorageWith(
  options: LatticeEmbedStorageOptions,
): Promise<(() => void) | null> {
  const snapshot = readSnapshot(await fetchSnapshot(options));
  if (!snapshot || !importSynaraStorageSnapshot(snapshot, options.storage)) return null;
  return startLatticeEmbedStorageMirror(options, new Map(Object.entries(snapshot.entries)));
}

/** Boot entry: a no-op outside Lattice's embed or without its token. */
export async function restoreLatticeEmbedStorage(): Promise<void> {
  if (!isLatticeEmbedDocument()) return;
  const token = readEmbeddedHostAuthToken();
  let storage: Storage | null = null;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    storage = null;
  }
  if (!token || !storage) return;
  await restoreLatticeEmbedStorageWith({ storage, token, origin: window.location.origin });
}

// FILE: providerUsage/keychainReads.ts
// Purpose: Remember macOS Keychain reads for the life of the server process. A
// `security find-generic-password` read of an item whose access list lacks `security` raises a
// SecurityAgent prompt, and "Allow" covers that one read only, so usage refreshes must not
// re-read on every poll. Granted secrets are reused for a long TTL (or until the caller reports
// the token they carried as expired or rejected, once per secret or explicit refresh); denied and
// failed reads are remembered until the user explicitly refreshes usage or the caller's
// credential file changes. Concurrent
// callers share one in-flight read.

export type KeychainReadOutcome =
  | { readonly kind: "granted"; readonly value: string }
  | { readonly kind: "missing" }
  | { readonly kind: "denied" }
  | { readonly kind: "failed" };

export interface KeychainItem {
  readonly service: string;
  readonly account?: string | undefined;
  /** HOME the read runs under, when the caller pins it (keychain search lists follow HOME). */
  readonly scope?: string | undefined;
}

export interface KeychainReadOptions {
  /**
   * Fingerprint of the credential file this item unlocks. A change is a re-login, so a
   * remembered denial, failure or absence is read again; a granted secret is kept.
   */
  readonly generation?: string | undefined;
  /**
   * The caller found the token in the granted secret expired or rejected. Re-read once; when
   * the Keychain still returns the same secret, further re-read requests reuse it.
   */
  readonly reread?: boolean | undefined;
}

// `security` waits while its SecurityAgent prompt is open. Killing it earlier leaves a prompt
// whose answer reaches no one, so give a person time to read and answer it.
export const KEYCHAIN_PROMPT_TIMEOUT_MS = 60_000;
// `security` exits with errSecItemNotFound's low byte when no item matches; no prompt is shown.
const SECURITY_ITEM_NOT_FOUND_EXIT_CODE = 44;
const GRANTED_TTL_MS = 12 * 60 * 60 * 1000;
// An absent item never prompts, so a sign-in made after startup is still picked up.
const MISSING_TTL_MS = 5 * 60 * 1000;

interface RememberedRead {
  readonly outcome: KeychainReadOutcome;
  readonly readAtMs: number;
  readonly generation: string | undefined;
  /** A re-read returned this same secret; another re-read request cannot change it. */
  readonly rereadConfirmed: boolean;
}

const rememberedReads = new Map<string, RememberedRead>();
const inFlightReads = new Map<string, Promise<KeychainReadOutcome>>();

function itemKey(item: KeychainItem): string {
  return JSON.stringify([item.scope ?? null, item.service, item.account ?? null]);
}

/** Map a finished `security find-generic-password -w` run to an outcome. */
export function classifySecurityResult(
  error: (Error & { code?: unknown; killed?: boolean; signal?: unknown }) | null,
  stdout: string,
): KeychainReadOutcome {
  if (!error) {
    const value = stdout.trim();
    return value.length > 0 ? { kind: "granted", value } : { kind: "missing" };
  }
  if (error.killed || error.signal) {
    return { kind: "failed" };
  }
  if (error.code === SECURITY_ITEM_NOT_FOUND_EXIT_CODE) {
    return { kind: "missing" };
  }
  // Any other exit status is a refused or cancelled prompt; spawn errors carry string codes.
  return typeof error.code === "number" ? { kind: "denied" } : { kind: "failed" };
}

function canReuse(
  remembered: RememberedRead,
  options: KeychainReadOptions,
  nowMs: number,
): boolean {
  const ageMs = nowMs - remembered.readAtMs;
  switch (remembered.outcome.kind) {
    case "granted":
      return ageMs < GRANTED_TTL_MS && !(options.reread && !remembered.rereadConfirmed);
    case "missing":
      return ageMs < MISSING_TTL_MS && remembered.generation === options.generation;
    case "denied":
    case "failed":
      return remembered.generation === options.generation;
  }
}

/** Read a Keychain item at most once per policy above; `read` runs `security` itself. */
export function readKeychainItemOnce(
  item: KeychainItem,
  read: () => Promise<KeychainReadOutcome>,
  options: KeychainReadOptions = {},
): Promise<KeychainReadOutcome> {
  const key = itemKey(item);
  const pending = inFlightReads.get(key);
  if (pending) {
    return pending;
  }
  const remembered = rememberedReads.get(key);
  if (remembered && canReuse(remembered, options, Date.now())) {
    return Promise.resolve(remembered.outcome);
  }
  const previousSecret =
    options.reread && remembered?.outcome.kind === "granted" ? remembered.outcome.value : null;
  const promise = read()
    .catch((): KeychainReadOutcome => ({ kind: "failed" }))
    .then((outcome) => {
      rememberedReads.set(key, {
        outcome,
        readAtMs: Date.now(),
        generation: options.generation,
        rereadConfirmed: outcome.kind === "granted" && outcome.value === previousSecret,
      });
      return outcome;
    })
    .finally(() => {
      if (inFlightReads.get(key) === promise) {
        inFlightReads.delete(key);
      }
    });
  inFlightReads.set(key, promise);
  return promise;
}

/**
 * Explicit user refresh: read denied, failed and absent items again. Granted secrets stay, but a
 * caller that finds their token expired or rejected may re-read them once more.
 */
export function forgetUnavailableKeychainReads(): void {
  for (const [key, remembered] of rememberedReads) {
    if (remembered.outcome.kind !== "granted") {
      rememberedReads.delete(key);
    } else if (remembered.rereadConfirmed) {
      rememberedReads.set(key, { ...remembered, rereadConfirmed: false });
    }
  }
}

/** Test-only: drop every remembered and in-flight read. */
export function __resetKeychainReadsForTests(): void {
  rememberedReads.clear();
  inFlightReads.clear();
}

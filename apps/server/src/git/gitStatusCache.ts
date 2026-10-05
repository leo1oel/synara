import type {
  GitBranchPullRequest,
  GitStatusLocalResult,
  GitStatusRemoteResult,
  GitStatusResult,
} from "@synara/contracts";

export interface CachedValue<T> {
  readonly fingerprint: string;
  readonly updatedAt: number;
  readonly value: T;
}

export interface CachedGitStatus {
  readonly local: CachedValue<GitStatusLocalResult> | null;
  readonly remote: CachedValue<GitStatusRemoteResult | null> | null;
}

/**
 * A resolved branch pull request, valid only for the branch/upstream it was looked up for.
 */
export interface CachedBranchPullRequest {
  readonly branchKey: string;
  readonly updatedAt: number;
  readonly pr: GitBranchPullRequest | null;
}

/**
 * How long a branch's pull request lookup is reused. Every lookup is several `gh` network
 * round trips, and many surfaces (and several clients) poll the same checkout.
 */
export const BRANCH_PULL_REQUEST_CACHE_TTL_MS = 30_000;

/**
 * Upper bound on cached working directories.
 *
 * Synara creates a git worktree per thread, so `cwd` keys are effectively
 * thread-scoped and unbounded over a long-lived server. The caches are pure
 * optimizations — a miss just re-runs git or gh — so evicting the least
 * recently written directory is always safe, and it keeps the copy-on-write update
 * below O(limit) instead of O(directories ever seen).
 */
export const GIT_STATUS_CACHE_MAX_ENTRIES = 64;

/**
 * Copy-on-write insert with least-recently-written eviction. Re-inserting the key
 * moves it to the end of `Map` iteration order, so the first key is always the
 * coldest entry.
 */
export function setBoundedCacheEntry<T>(
  cache: ReadonlyMap<string, T>,
  cwd: string,
  next: T,
  maxEntries: number = GIT_STATUS_CACHE_MAX_ENTRIES,
): Map<string, T> {
  const nextCache = new Map(cache);
  nextCache.delete(cwd);
  nextCache.set(cwd, next);
  while (nextCache.size > maxEntries) {
    const coldest = nextCache.keys().next().value;
    if (coldest === undefined) {
      break;
    }
    nextCache.delete(coldest);
  }
  return nextCache;
}

export function makeCachedStatusValue<T>(value: T): CachedValue<T> {
  return {
    fingerprint: JSON.stringify(value),
    updatedAt: Date.now(),
    value,
  };
}

export function splitLocalStatus(status: GitStatusResult): GitStatusLocalResult {
  return {
    branch: status.branch,
    hasWorkingTreeChanges: status.hasWorkingTreeChanges,
    workingTree: status.workingTree,
  };
}

export function splitRemoteStatus(status: GitStatusResult): GitStatusRemoteResult {
  return {
    hasUpstream: status.hasUpstream,
    upstreamBranch: status.upstreamBranch,
    configuredPrBaseBranch: status.configuredPrBaseBranch,
    aheadCount: status.aheadCount,
    behindCount: status.behindCount,
  };
}

/** Identity of the branch a pull request lookup was made for. */
export function branchPullRequestCacheKey(input: {
  readonly branch: string;
  readonly upstreamRef: string | null;
}): string {
  return JSON.stringify([input.branch, input.upstreamRef]);
}

export function readFreshBranchPullRequest(input: {
  readonly cached: CachedBranchPullRequest | undefined;
  readonly branchKey: string;
  readonly now?: number;
  readonly ttlMs?: number;
}): CachedBranchPullRequest | null {
  const cached = input.cached;
  if (!cached || cached.branchKey !== input.branchKey) return null;
  const age = (input.now ?? Date.now()) - cached.updatedAt;
  return age < (input.ttlMs ?? BRANCH_PULL_REQUEST_CACHE_TTL_MS) ? cached : null;
}

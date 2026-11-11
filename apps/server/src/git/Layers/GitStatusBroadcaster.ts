import { realpathSync } from "node:fs";

import { Effect, Layer, PubSub, Ref, Result, Stream } from "effect";
import type {
  GitStatusLocalResult,
  GitStatusRemoteResult,
  GitStatusResult,
  GitStatusStreamEvent,
} from "@synara/contracts";
import { mergeGitStatusParts } from "@synara/shared/git";

import { GitCore } from "../Services/GitCore";
import { GitManager } from "../Services/GitManager";
import {
  GitStatusBroadcaster,
  type GitStatusBroadcasterShape,
} from "../Services/GitStatusBroadcaster";
import {
  branchPullRequestCacheKey,
  type CachedBranchPullRequest,
  type CachedGitStatus,
  makeCachedStatusValue,
  readFreshBranchPullRequest,
  setBoundedCacheEntry,
  splitLocalStatus,
  splitRemoteStatus,
} from "../gitStatusCache";

interface GitStatusChange {
  readonly cwd: string;
  readonly event: GitStatusStreamEvent;
}

function normalizeCwd(cwd: string): string {
  try {
    return realpathSync.native(cwd);
  } catch {
    return cwd;
  }
}

export const GitStatusBroadcasterLive = Layer.effect(
  GitStatusBroadcaster,
  Effect.gen(function* () {
    const gitCore = yield* GitCore;
    const gitManager = yield* GitManager;
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<GitStatusChange>(),
      (pubsub) => PubSub.shutdown(pubsub),
    );
    const cacheRef = yield* Ref.make(new Map<string, CachedGitStatus>());
    // `generation` is bumped by every refresh. A lookup that started before a refresh may
    // have read GitHub before the mutation that triggered it, so it must not be cached.
    const pullRequestCacheRef = yield* Ref.make({
      generation: 0,
      entries: new Map<string, CachedBranchPullRequest>() as ReadonlyMap<
        string,
        CachedBranchPullRequest
      >,
    });

    const updateCachedLocalStatus = (
      cwd: string,
      local: GitStatusLocalResult,
      options?: { readonly publish?: boolean },
    ) =>
      Effect.gen(function* () {
        const nextLocal = makeCachedStatusValue(local);
        const shouldPublish = yield* Ref.modify(cacheRef, (cache) => {
          const previous = cache.get(cwd) ?? { local: null, remote: null };
          const nextCache = setBoundedCacheEntry(cache, cwd, { ...previous, local: nextLocal });
          return [previous.local?.fingerprint !== nextLocal.fingerprint, nextCache] as const;
        });

        if (options?.publish && shouldPublish) {
          yield* PubSub.publish(changesPubSub, {
            cwd,
            event: { _tag: "localUpdated", local },
          });
        }

        return local;
      });

    const updateCachedRemoteStatus = (
      cwd: string,
      remote: GitStatusRemoteResult | null,
      options?: { readonly publish?: boolean },
    ) =>
      Effect.gen(function* () {
        const nextRemote = makeCachedStatusValue(remote);
        const shouldPublish = yield* Ref.modify(cacheRef, (cache) => {
          const previous = cache.get(cwd) ?? { local: null, remote: null };
          const nextCache = setBoundedCacheEntry(cache, cwd, { ...previous, remote: nextRemote });
          return [previous.remote?.fingerprint !== nextRemote.fingerprint, nextCache] as const;
        });

        if (options?.publish && shouldPublish) {
          yield* PubSub.publish(changesPubSub, {
            cwd,
            event: { _tag: "remoteUpdated", remote },
          });
        }

        return remote;
      });

    const loadStatus = (cwd: string, options?: { readonly publish?: boolean }) =>
      Effect.gen(function* () {
        const status = yield* gitManager.status({ cwd });
        const local = yield* updateCachedLocalStatus(cwd, splitLocalStatus(status), options);
        const remote = yield* updateCachedRemoteStatus(cwd, splitRemoteStatus(status), options);
        return mergeGitStatusParts(local, remote) as GitStatusResult;
      });

    // Status is local git state only, so every read goes to git; the cache above only
    // fingerprints the last result so stream subscribers hear about real changes.
    const getStatus: GitStatusBroadcasterShape["getStatus"] = (input) =>
      loadStatus(normalizeCwd(input.cwd));

    const refreshStatus: GitStatusBroadcasterShape["refreshStatus"] = (cwd) =>
      Effect.gen(function* () {
        const normalizedCwd = normalizeCwd(cwd);
        // Refreshes follow git mutations (push, PR creation, checkout), any of which can
        // change the branch's pull request, so the next lookup must go back to GitHub.
        yield* Ref.update(pullRequestCacheRef, (cache) => {
          const entries = new Map(cache.entries);
          entries.delete(normalizedCwd);
          return { generation: cache.generation + 1, entries };
        });
        return yield* loadStatus(normalizedCwd, { publish: true });
      });

    const getBranchPullRequest: GitStatusBroadcasterShape["getBranchPullRequest"] = (input) =>
      Effect.gen(function* () {
        const normalizedCwd = normalizeCwd(input.cwd);
        const branchContext = yield* gitCore.readBranchContext(normalizedCwd);
        if (!branchContext.isRepo || branchContext.branch === null) {
          return { branch: branchContext.branch, pr: null };
        }
        const branch = branchContext.branch;
        const branchKey = branchPullRequestCacheKey({
          branch,
          upstreamRef: branchContext.upstreamRef,
        });
        const cache = yield* Ref.get(pullRequestCacheRef);
        const cached = readFreshBranchPullRequest({
          cached: cache.entries.get(normalizedCwd),
          branchKey,
        });
        if (cached) {
          return { branch, pr: cached.pr };
        }

        const lookup = yield* gitManager
          .pullRequestForBranch({
            cwd: normalizedCwd,
            branch,
            upstreamRef: branchContext.upstreamRef,
          })
          .pipe(Effect.result);
        // A failed lookup (gh missing, signed out, offline) reads as "no PR" but is not
        // cached, so the next poll retries instead of pinning the failure for the TTL.
        if (Result.isFailure(lookup)) {
          return { branch: branchContext.branch, pr: null };
        }
        yield* Ref.update(pullRequestCacheRef, (current) =>
          current.generation === cache.generation
            ? {
                generation: current.generation,
                entries: setBoundedCacheEntry(current.entries, normalizedCwd, {
                  branchKey,
                  updatedAt: Date.now(),
                  pr: lookup.success,
                }),
              }
            : current,
        );
        return { branch, pr: lookup.success };
      });

    const refreshLocalStatus: GitStatusBroadcasterShape["refreshLocalStatus"] = (cwd) =>
      refreshStatus(cwd).pipe(Effect.map(splitLocalStatus));

    const streamStatus: GitStatusBroadcasterShape["streamStatus"] = (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const normalizedCwd = normalizeCwd(input.cwd);
          const subscription = yield* PubSub.subscribe(changesPubSub);
          const status = yield* getStatus({ cwd: normalizedCwd });
          const snapshot: GitStatusStreamEvent = {
            _tag: "snapshot",
            local: splitLocalStatus(status),
            remote: splitRemoteStatus(status),
          };

          return Stream.concat(
            Stream.make(snapshot),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((change) => change.cwd === normalizedCwd),
              Stream.map((change) => change.event),
            ),
          );
        }),
      );

    return {
      getStatus,
      getBranchPullRequest,
      refreshLocalStatus,
      refreshStatus,
      streamStatus,
    } satisfies GitStatusBroadcasterShape;
  }),
);

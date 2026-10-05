import type {
  GitBranchPullRequest,
  GitStatusResult,
  GitStatusStreamEvent,
} from "@synara/contracts";
import { Deferred, Effect, Fiber, Layer, Scope, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitHubCliError, type GitManagerServiceError } from "../Errors";
import { GitCore, type GitBranchContext, type GitCoreShape } from "../Services/GitCore";
import { GitManager, type GitManagerShape } from "../Services/GitManager";
import { GitStatusBroadcaster } from "../Services/GitStatusBroadcaster";
import { GIT_STATUS_CACHE_MAX_ENTRIES } from "../gitStatusCache";
import { GitStatusBroadcasterLive } from "./GitStatusBroadcaster";

const baseStatus: GitStatusResult = {
  branch: "feature/status-broadcast",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: true,
  upstreamBranch: "feature/status-broadcast",
  aheadCount: 0,
  behindCount: 0,
};

const baseBranchContext: GitBranchContext = {
  isRepo: true,
  branch: baseStatus.branch,
  upstreamRef: "origin/feature/status-broadcast",
};

function makePullRequest(number: number): GitBranchPullRequest {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/repo/pull/${number}`,
    state: "open",
    baseBranch: "main",
    headBranch: "feature/status-broadcast",
    isDraft: false,
    mergeability: "unknown",
    additions: null,
    deletions: null,
    changedFiles: null,
  };
}

interface TestState {
  currentStatus: GitStatusResult;
  currentBranchContext: GitBranchContext;
  statusCalls: number;
  pullRequestLookups: Array<{ branch: string; upstreamRef: string | null }>;
  lookupPullRequest: Effect.Effect<GitBranchPullRequest | null, GitManagerServiceError>;
}

function makeState(overrides?: Partial<TestState>): TestState {
  return {
    currentStatus: baseStatus,
    currentBranchContext: baseBranchContext,
    statusCalls: 0,
    pullRequestLookups: [],
    lookupPullRequest: Effect.succeed(null),
    ...overrides,
  };
}

function makeTestLayer(state: TestState) {
  const gitCore = {
    readBranchContext: () => Effect.sync(() => state.currentBranchContext),
  } as unknown as GitCoreShape;
  const gitManager: GitManagerShape = {
    connectGitHubRemote: () => Effect.die("connectGitHubRemote should not be called in this test"),
    createGitHubRepository: () =>
      Effect.die("createGitHubRepository should not be called in this test"),
    status: () =>
      Effect.sync(() => {
        state.statusCalls += 1;
        return state.currentStatus;
      }),
    pullRequestForBranch: (input) =>
      Effect.suspend(() => {
        state.pullRequestLookups.push({ branch: input.branch, upstreamRef: input.upstreamRef });
        return state.lookupPullRequest;
      }),
    readWorkingTreeDiff: () => Effect.die("readWorkingTreeDiff should not be called in this test"),
    readWorkingTreeDiffStats: () =>
      Effect.die("readWorkingTreeDiffStats should not be called in this test"),
    blameLine: () => Effect.die("blameLine should not be called in this test"),
    readFileAtRev: () => Effect.die("readFileAtRev should not be called in this test"),
    summarizeDiff: () => Effect.die("summarizeDiff should not be called in this test"),
    resolvePullRequest: () => Effect.die("resolvePullRequest should not be called in this test"),
    pullRequestSnapshot: () => Effect.die("pullRequestSnapshot should not be called in this test"),
    preparePullRequestThread: () =>
      Effect.die("preparePullRequestThread should not be called in this test"),
    handoffThread: () => Effect.die("handoffThread should not be called in this test"),
    runStackedAction: () => Effect.die("runStackedAction should not be called in this test"),
  };

  return GitStatusBroadcasterLive.pipe(
    Layer.provide(
      Layer.mergeAll(Layer.succeed(GitCore, gitCore), Layer.succeed(GitManager, gitManager)),
    ),
  );
}

const runBroadcasterTest = (
  state: TestState,
  effect: Effect.Effect<void, GitManagerServiceError, GitStatusBroadcaster | Scope.Scope>,
) => effect.pipe(Effect.provide(makeTestLayer(state)), Effect.scoped, Effect.runPromise);

afterEach(() => {
  vi.useRealTimers();
});

describe("GitStatusBroadcasterLive", () => {
  it("serves status without looking up the branch pull request", async () => {
    // A lookup that never finishes stands in for a slow or hung GitHub round trip.
    const state = makeState({ lookupPullRequest: Effect.never });

    await runBroadcasterTest(
      state,
      Effect.gen(function* () {
        const broadcaster = yield* GitStatusBroadcaster;

        const first = yield* broadcaster.getStatus({ cwd: "/repo" });
        state.currentStatus = {
          ...baseStatus,
          hasWorkingTreeChanges: true,
          workingTree: {
            files: [{ path: "src/app.ts", insertions: 5, deletions: 1 }],
            insertions: 5,
            deletions: 1,
          },
        };
        const second = yield* broadcaster.getStatus({ cwd: "/repo" });

        expect(first).toEqual(baseStatus);
        expect(second).toEqual(state.currentStatus);
        expect(state.statusCalls).toBe(2);
        expect(state.pullRequestLookups).toEqual([]);
      }),
    );
  });

  it("resolves the branch pull request separately and reuses it within the TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const state = makeState({ lookupPullRequest: Effect.succeed(makePullRequest(42)) });

    await runBroadcasterTest(
      state,
      Effect.gen(function* () {
        const broadcaster = yield* GitStatusBroadcaster;

        const first = yield* broadcaster.getBranchPullRequest({ cwd: "/repo" });
        vi.setSystemTime(20_000);
        const second = yield* broadcaster.getBranchPullRequest({ cwd: "/repo" });

        expect(first.pr?.number).toBe(42);
        expect(second.pr?.number).toBe(42);
        expect(state.pullRequestLookups).toEqual([
          { branch: baseBranchContext.branch, upstreamRef: baseBranchContext.upstreamRef },
        ]);
        expect(state.statusCalls).toBe(0);

        vi.setSystemTime(31_000);
        state.lookupPullRequest = Effect.succeed(makePullRequest(43));
        const expired = yield* broadcaster.getBranchPullRequest({ cwd: "/repo" });
        expect(expired.pr?.number).toBe(43);
        expect(state.pullRequestLookups).toHaveLength(2);
      }),
    );
  });

  it("looks the pull request up again when the branch changes", async () => {
    const state = makeState({ lookupPullRequest: Effect.succeed(makePullRequest(42)) });

    await runBroadcasterTest(
      state,
      Effect.gen(function* () {
        const broadcaster = yield* GitStatusBroadcaster;

        yield* broadcaster.getBranchPullRequest({ cwd: "/repo" });
        state.currentBranchContext = { ...baseBranchContext, branch: "feature/other" };
        state.lookupPullRequest = Effect.succeed(null);
        const switched = yield* broadcaster.getBranchPullRequest({ cwd: "/repo" });

        expect(switched.pr).toBeNull();
        expect(state.pullRequestLookups.map((lookup) => lookup.branch)).toEqual([
          baseBranchContext.branch,
          "feature/other",
        ]);
      }),
    );
  });

  it("skips GitHub for detached HEADs and non-repositories", async () => {
    const state = makeState({
      currentBranchContext: { isRepo: true, branch: null, upstreamRef: null },
    });

    await runBroadcasterTest(
      state,
      Effect.gen(function* () {
        const broadcaster = yield* GitStatusBroadcaster;

        expect(yield* broadcaster.getBranchPullRequest({ cwd: "/repo" })).toEqual({
          branch: null,
          pr: null,
        });
        state.currentBranchContext = { isRepo: false, branch: null, upstreamRef: null };
        expect(yield* broadcaster.getBranchPullRequest({ cwd: "/repo" })).toEqual({
          branch: null,
          pr: null,
        });
        expect(state.pullRequestLookups).toEqual([]);
      }),
    );
  });

  it("reports gh failures as no pull request without caching them", async () => {
    const state = makeState({
      lookupPullRequest: Effect.fail(
        new GitHubCliError({ operation: "execute", detail: "gh auth login required" }),
      ),
    });

    await runBroadcasterTest(
      state,
      Effect.gen(function* () {
        const broadcaster = yield* GitStatusBroadcaster;

        const failed = yield* broadcaster.getBranchPullRequest({ cwd: "/repo" });
        state.lookupPullRequest = Effect.succeed(makePullRequest(7));
        const recovered = yield* broadcaster.getBranchPullRequest({ cwd: "/repo" });

        expect(failed).toEqual({ branch: baseBranchContext.branch, pr: null });
        expect(recovered.pr?.number).toBe(7);
        expect(state.pullRequestLookups).toHaveLength(2);
      }),
    );
  });

  it("drops the cached pull request when status is refreshed after a mutation", async () => {
    const state = makeState({ lookupPullRequest: Effect.succeed(null) });

    await runBroadcasterTest(
      state,
      Effect.gen(function* () {
        const broadcaster = yield* GitStatusBroadcaster;

        expect((yield* broadcaster.getBranchPullRequest({ cwd: "/repo" })).pr).toBeNull();
        state.lookupPullRequest = Effect.succeed(makePullRequest(101));
        yield* broadcaster.refreshStatus("/repo");
        const afterRefresh = yield* broadcaster.getBranchPullRequest({ cwd: "/repo" });

        expect(afterRefresh.pr?.number).toBe(101);
        expect(state.pullRequestLookups).toHaveLength(2);
      }),
    );
  });

  it("does not cache a lookup that was in flight across a refresh", async () => {
    const state = makeState();

    await runBroadcasterTest(
      state,
      Effect.gen(function* () {
        const broadcaster = yield* GitStatusBroadcaster;
        const lookupStarted = yield* Deferred.make<void>();
        const releaseLookup = yield* Deferred.make<void>();
        state.lookupPullRequest = Deferred.succeed(lookupStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseLookup)),
          Effect.as(null),
        );

        const staleLookup = yield* broadcaster
          .getBranchPullRequest({ cwd: "/repo" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(lookupStarted);
        // e.g. "Commit, push & create PR" finishes while the old lookup is still running.
        yield* broadcaster.refreshStatus("/repo");
        yield* Deferred.succeed(releaseLookup, undefined);
        yield* Fiber.join(staleLookup);

        state.lookupPullRequest = Effect.succeed(makePullRequest(55));
        const fresh = yield* broadcaster.getBranchPullRequest({ cwd: "/repo" });

        expect(fresh.pr?.number).toBe(55);
        expect(state.pullRequestLookups).toHaveLength(2);
      }),
    );
  });

  it("evicts the coldest working directory once the pull request cache is full", async () => {
    const state = makeState();

    await runBroadcasterTest(
      state,
      Effect.gen(function* () {
        const broadcaster = yield* GitStatusBroadcaster;

        // Every thread worktree is a distinct cwd, so an unbounded cache would pin
        // pull request lookups for every directory the server ever saw.
        for (let index = 0; index <= GIT_STATUS_CACHE_MAX_ENTRIES; index += 1) {
          yield* broadcaster.getBranchPullRequest({ cwd: `/worktrees/repo-${index}` });
        }
        expect(state.pullRequestLookups).toHaveLength(GIT_STATUS_CACHE_MAX_ENTRIES + 1);

        yield* broadcaster.getBranchPullRequest({
          cwd: `/worktrees/repo-${GIT_STATUS_CACHE_MAX_ENTRIES}`,
        });
        expect(state.pullRequestLookups).toHaveLength(GIT_STATUS_CACHE_MAX_ENTRIES + 1);

        yield* broadcaster.getBranchPullRequest({ cwd: "/worktrees/repo-0" });
        expect(state.pullRequestLookups).toHaveLength(GIT_STATUS_CACHE_MAX_ENTRIES + 2);
      }),
    );
  });

  it("streams a status snapshot first and later refresh updates", async () => {
    const state = makeState();

    await runBroadcasterTest(
      state,
      Effect.gen(function* () {
        const broadcaster = yield* GitStatusBroadcaster;
        const snapshotDeferred = yield* Deferred.make<GitStatusStreamEvent>();
        const localUpdatedDeferred = yield* Deferred.make<GitStatusStreamEvent>();

        yield* Stream.runForEach(broadcaster.streamStatus({ cwd: "/repo" }), (event) => {
          if (event._tag === "snapshot") {
            return Deferred.succeed(snapshotDeferred, event).pipe(Effect.ignore);
          }
          if (event._tag === "localUpdated") {
            return Deferred.succeed(localUpdatedDeferred, event).pipe(Effect.ignore);
          }
          return Effect.void;
        }).pipe(Effect.forkScoped);

        const snapshot = yield* Deferred.await(snapshotDeferred);
        state.currentStatus = {
          ...baseStatus,
          branch: "feature/local-refresh",
        };
        yield* broadcaster.refreshStatus("/repo");
        const localUpdated = yield* Deferred.await(localUpdatedDeferred);

        expect(snapshot).toEqual({
          _tag: "snapshot",
          local: {
            branch: baseStatus.branch,
            hasWorkingTreeChanges: baseStatus.hasWorkingTreeChanges,
            workingTree: baseStatus.workingTree,
          },
          remote: {
            hasUpstream: baseStatus.hasUpstream,
            upstreamBranch: baseStatus.upstreamBranch,
            aheadCount: baseStatus.aheadCount,
            behindCount: baseStatus.behindCount,
          },
        });
        expect(localUpdated).toEqual({
          _tag: "localUpdated",
          local: {
            branch: "feature/local-refresh",
            hasWorkingTreeChanges: false,
            workingTree: baseStatus.workingTree,
          },
        });
      }),
    );
  });
});

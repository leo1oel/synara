import type {
  GitBranchPullRequestInput,
  GitBranchPullRequestResult,
  GitStatusInput,
  GitStatusLocalResult,
  GitStatusResult,
  GitStatusStreamEvent,
} from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";
import type { GitManagerServiceError } from "../Errors";

export interface GitStatusBroadcasterShape {
  readonly getStatus: (
    input: GitStatusInput,
  ) => Effect.Effect<GitStatusResult, GitManagerServiceError>;
  /**
   * The current branch's pull request, served apart from status because it needs GitHub
   * round trips. Lookup failures (gh missing, signed out, offline) resolve to `pr: null`.
   */
  readonly getBranchPullRequest: (
    input: GitBranchPullRequestInput,
  ) => Effect.Effect<GitBranchPullRequestResult, GitManagerServiceError>;
  readonly refreshLocalStatus: (
    cwd: string,
  ) => Effect.Effect<GitStatusLocalResult, GitManagerServiceError>;
  readonly refreshStatus: (cwd: string) => Effect.Effect<GitStatusResult, GitManagerServiceError>;
  readonly streamStatus: (
    input: GitStatusInput,
  ) => Stream.Stream<GitStatusStreamEvent, GitManagerServiceError>;
}

export class GitStatusBroadcaster extends ServiceMap.Service<
  GitStatusBroadcaster,
  GitStatusBroadcasterShape
>()("synara/git/Services/GitStatusBroadcaster") {}

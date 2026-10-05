import type { PullRequestsUnavailableError } from "@synara/contracts";

export function isPullRequestsUnavailableError(
  error: unknown,
): error is PullRequestsUnavailableError {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "PullRequestsUnavailableError"
  );
}

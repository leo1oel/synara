import {
  isValidGitHubRepositoryNameWithOwner,
  parseGitHubRepositoryNameWithOwnerFromRemoteUrl,
} from "@synara/shared/githubRepository";

const GITHUB_REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function isValidGitHubRepositoryCreateName(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length === 0) return false;
  if (normalized.includes("/")) {
    return isValidGitHubRepositoryNameWithOwner(normalized);
  }
  return (
    normalized.length <= 100 &&
    normalized !== "." &&
    normalized !== ".." &&
    GITHUB_REPOSITORY_NAME_PATTERN.test(normalized)
  );
}

export function suggestGitHubRepositoryName(cwd: string): string {
  const normalizedPath = cwd.replaceAll("\\", "/").replace(/\/+$/g, "");
  const folderName = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1).trim();
  const sanitized = folderName
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100);
  return isValidGitHubRepositoryCreateName(sanitized) ? sanitized : "new-repository";
}

export function isValidGitHubRemoteUrl(value: string): boolean {
  return parseGitHubRepositoryNameWithOwnerFromRemoteUrl(value) !== null;
}

// FILE: scratchObjectStore.ts
// Purpose: Keeps the objects a read-only preview hashes out of the user's repository.
// Layer: Server Git helpers (pure; GitCore owns the processes and the temporary directory)
import nodePath from "node:path";

// `GIT_INDEX_FILE` moves only the staging area. A `git add` into a copied index
// still writes every blob it hashes into the repository's real object database,
// and past `core.bigFileThreshold` it streams them into a `tmp_pack_*` there that
// a killed Git (a status timeout) leaves behind for good. Previews that stage
// only to read a diff therefore point `GIT_OBJECT_DIRECTORY` at a scratch
// directory the caller deletes, and reach the repository's existing objects
// through it as a read-only alternate, so unchanged files are not rewritten.

// The scratch objects are deleted moments later, so spend no CPU deflating them;
// this is several times faster than the default level on incompressible data.
export const SCRATCH_OBJECT_STORE_GIT_CONFIG_ARGS: ReadonlyArray<string> = [
  "-c",
  "core.compression=0",
  "-c",
  "core.looseCompression=0",
  "-c",
  "pack.compression=0",
];

// Git splits GIT_ALTERNATE_OBJECT_DIRECTORIES on the platform's PATH separator
// and reads an entry starting with a double quote as a C-style quoted path.
export function quoteAlternateObjectDirectory(directory: string): string {
  if (!directory.includes(nodePath.delimiter) && !/["\\\n]/.test(directory)) {
    return directory;
  }
  const escaped = directory.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

export function scratchObjectStoreEnv(input: {
  readonly scratchObjectDirectory: string;
  readonly repositoryObjectDirectory: string;
  readonly inheritedAlternates?: string | undefined;
}): { GIT_OBJECT_DIRECTORY: string; GIT_ALTERNATE_OBJECT_DIRECTORIES: string } {
  const alternates = [quoteAlternateObjectDirectory(input.repositoryObjectDirectory)];
  if (input.inheritedAlternates && input.inheritedAlternates.length > 0) {
    alternates.push(input.inheritedAlternates);
  }
  return {
    GIT_OBJECT_DIRECTORY: input.scratchObjectDirectory,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: alternates.join(nodePath.delimiter),
  };
}

export type UntrackedFileSize = {
  /** Repository-relative path, as `git ls-files --full-name` prints it. */
  readonly path: string;
  /** Size of a regular file; null for anything Git does not hash by content size. */
  readonly size: number | null;
};

export type MoveAwareHashLimits = {
  /** An untracked file larger than this is left out of the add and counted as binary. */
  readonly largeFileBytes: number;
  /** Above this many untracked bytes to hash, the rename-aware summary is skipped. */
  readonly hashBudgetBytes: number;
};

export type UntrackedHashPlan =
  | { readonly kind: "hash"; readonly excludedPaths: ReadonlyArray<string> }
  | { readonly kind: "over-budget"; readonly hashedBytes: number };

/**
 * Decides which untracked files the rename-aware status may hash. Huge
 * research artifacts are never worth hashing for a line count (Git would report
 * them as binary anyway), and a status refresh must stay fast however much
 * untracked data sits in the worktree.
 */
export function planUntrackedHashing(
  files: ReadonlyArray<UntrackedFileSize>,
  limits: MoveAwareHashLimits,
): UntrackedHashPlan {
  const excludedPaths: string[] = [];
  let hashedBytes = 0;
  for (const file of files) {
    if (file.size === null) continue;
    if (file.size > limits.largeFileBytes) {
      excludedPaths.push(file.path);
      continue;
    }
    hashedBytes += file.size;
  }
  if (hashedBytes > limits.hashBudgetBytes) {
    return { kind: "over-budget", hashedBytes };
  }
  return { kind: "hash", excludedPaths };
}

/** A pathspec that keeps one repository-relative path, taken literally, out of an add. */
export function excludeLiteralPathspec(repositoryRelativePath: string): string {
  return `:(top,exclude,literal)${repositoryRelativePath}`;
}

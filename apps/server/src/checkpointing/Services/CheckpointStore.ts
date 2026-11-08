/**
 * CheckpointStore - Repository interface for filesystem-backed workspace checkpoints.
 *
 * Owns hidden Git-ref checkpoint capture/restore and diff computation for a
 * workspace thread timeline. It does not store user-facing checkpoint metadata
 * and does not coordinate provider conversation rollback.
 *
 * Uses Effect `ServiceMap.Service` for dependency injection and exposes typed
 * domain errors for checkpoint storage operations.
 *
 * @module CheckpointStore
 */
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { CheckpointStoreError } from "../Errors.ts";
import { CheckpointRef, type ThreadId } from "@synara/contracts";

export interface CaptureCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
  /**
   * Treat an already-existing ref as success and skip the capture.
   *
   * Used for pre-turn baseline refs where the first snapshot must win:
   * overwriting an existing baseline with a later capture would record a
   * working tree the agent may already have modified.
   */
  readonly skipIfExists?: boolean;
}

export interface CopyCheckpointRefInput {
  readonly cwd: string;
  readonly fromCheckpointRef: CheckpointRef;
  readonly toCheckpointRef: CheckpointRef;
}

export interface RestoreCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
  readonly fallbackToHead?: boolean;
}

export interface DiffCheckpointsInput {
  readonly cwd: string;
  readonly fromCheckpointRef: CheckpointRef;
  readonly toCheckpointRef: CheckpointRef;
  readonly fallbackFromToHead?: boolean;
  readonly ignoreWhitespace: boolean;
  /** Exact immutable provider patch; reconstruct only from fromCheckpointRef in a private index. */
  readonly providerPatch?: string;
  readonly maxOutputBytes?: number;
}

export interface ReverseCheckpointDiffInput {
  readonly cwd: string;
  readonly fromCheckpointRef: CheckpointRef;
  readonly toCheckpointRef: CheckpointRef;
  readonly maxOutputBytes?: number;
}

/**
 * A reverse patch that ran. `conflictedPaths` lists the files where the
 * workspace had changed the very lines the patch reverses: each keeps the rest
 * of the undo and carries diff3 conflict markers (ours = the current text,
 * base = the checkpoint's text, theirs = the text before the checkpoint) for
 * just those spots, for the user to resolve.
 */
export interface ReverseCheckpointDiffResult {
  readonly conflictedPaths: ReadonlyArray<string>;
}

export interface HostWritesInput {
  readonly cwd: string;
  /** From `checkpointRefForThreadTurnHostWrites`. */
  readonly ref: CheckpointRef;
}

export interface DeleteCheckpointRefsInput {
  readonly cwd: string;
  readonly checkpointRefs: ReadonlyArray<CheckpointRef>;
  /** Purge all revision refs owned by this thread, including crash-orphaned captures. */
  readonly liveThreadId?: ThreadId;
}

/**
 * CheckpointStoreShape - Service API for checkpoint capture/restore and diff access.
 */
export interface CheckpointStoreShape {
  /**
   * Check whether cwd is inside a Git worktree.
   */
  readonly isGitRepository: (cwd: string) => Effect.Effect<boolean, CheckpointStoreError>;

  /**
   * Capture a checkpoint commit and store it at the provided checkpoint ref.
   *
   * Uses an isolated temporary Git index and writes a hidden ref.
   */
  readonly captureCheckpoint: (
    input: CaptureCheckpointInput,
  ) => Effect.Effect<void, CheckpointStoreError>;

  /**
   * Copy an existing checkpoint commit to another hidden ref.
   *
   * Used to bind a pre-send message snapshot to the provider turn id once known.
   */
  readonly copyCheckpointRef: (
    input: CopyCheckpointRefInput,
  ) => Effect.Effect<boolean, CheckpointStoreError>;

  /**
   * Check whether a checkpoint ref exists.
   */
  readonly hasCheckpointRef: (
    input: Omit<RestoreCheckpointInput, "fallbackToHead">,
  ) => Effect.Effect<boolean, CheckpointStoreError>;

  /**
   * Restore workspace/staging state to a checkpoint.
   *
   * Optionally falls back to current `HEAD` when the checkpoint ref is missing.
   */
  readonly restoreCheckpoint: (
    input: RestoreCheckpointInput,
  ) => Effect.Effect<boolean, CheckpointStoreError>;

  /**
   * Compute patch diff between two checkpoint refs.
   *
   * Can optionally treat missing "from" ref as `HEAD`.
   */
  readonly diffCheckpoints: (
    input: DiffCheckpointsInput,
  ) => Effect.Effect<string, CheckpointStoreError>;

  /**
   * Reverse only the changes between two checkpoints onto the current workspace.
   *
   * Edits made since the checkpoint are kept: a hunk they overlap becomes a
   * conflict in that file (see `ReverseCheckpointDiffResult`) rather than
   * refusing the whole undo. Resolves `false` when a checkpoint ref is missing.
   */
  readonly reverseCheckpointDiff: (
    input: ReverseCheckpointDiffInput,
  ) => Effect.Effect<ReverseCheckpointDiffResult | false, CheckpointStoreError>;

  /**
   * Add workspace-relative paths to the set the host wrote during a turn.
   */
  readonly recordHostWrites: (
    input: HostWritesInput & { readonly paths: ReadonlyArray<string> },
  ) => Effect.Effect<void, CheckpointStoreError>;

  /**
   * Paths the host wrote during a turn; empty when none were recorded.
   */
  readonly readHostWrites: (
    input: HostWritesInput,
  ) => Effect.Effect<ReadonlyArray<string>, CheckpointStoreError>;

  /**
   * Delete the provided checkpoint refs.
   *
   * Missing refs are tolerated (deleting an absent ref is a no-op for Git), but
   * a ref that exists and could not be deleted fails the effect: callers use
   * this to protect snapshots that are a user's only way back.
   */
  readonly deleteCheckpointRefs: (
    input: DeleteCheckpointRefsInput,
  ) => Effect.Effect<void, CheckpointStoreError>;
}

/**
 * CheckpointStore - Service tag for checkpoint persistence and restore operations.
 */
export class CheckpointStore extends ServiceMap.Service<CheckpointStore, CheckpointStoreShape>()(
  "synara/checkpointing/Services/CheckpointStore",
) {}

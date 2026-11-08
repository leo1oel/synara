// Lattice reports the project files it writes itself (a co-author's edit synced
// or streamed from Overleaf, the user's own save) so checkpoint Undo can tell
// them from the agent's. A turn's diff is the whole workspace between its
// start and end snapshots, so such an edit landing while the turn runs is
// inside that diff, and reversing it would delete the edit. This module parses
// the report and decides which turns it lands in; the route records them on
// the turn (`checkpointRefForThreadTurnHostWrites`), where Undo looks first.
import type { ProjectId, ProjectKind, ThreadId, TurnId } from "@synara/contracts";

import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils.ts";

export const LATTICE_HOST_FILE_WRITES = "lattice:host-file-writes";
const MAX_WRITES = 256;
const MAX_PATH_LENGTH = 1024;

/**
 * How long after a turn ends a write still counts as inside it. The turn-end
 * snapshot is taken after the turn completes, by a reactor that may be busy,
 * and the report travels through the panel; a write in that window may be in
 * the snapshot. Counting one that is not only refuses an Undo with a clear
 * message, while missing one deletes the edit, so the window is generous.
 */
export const HOST_WRITE_TURN_END_SLACK_MS = 30_000;

export interface LatticeHostFileWrites {
  readonly workspaceRoot: string;
  readonly writes: ReadonlyArray<{ readonly path: string; readonly writtenAt: number }>;
}

const isWorkspaceRelativePath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_PATH_LENGTH &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  !/^[A-Za-z]:/.test(value) &&
  value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");

export function parseLatticeHostFileWrites(value: unknown): LatticeHostFileWrites | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== LATTICE_HOST_FILE_WRITES || record.version !== 1) return null;
  const { workspaceRoot, writes } = record;
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim().length === 0) return null;
  if (workspaceRoot.length > 4096 || !Array.isArray(writes) || writes.length > MAX_WRITES) {
    return null;
  }
  const parsed: Array<{ path: string; writtenAt: number }> = [];
  for (const write of writes) {
    if (!write || typeof write !== "object") return null;
    const { path, writtenAt } = write as Record<string, unknown>;
    if (!isWorkspaceRelativePath(path)) return null;
    if (typeof writtenAt !== "string") return null;
    const writtenAtMs = Date.parse(writtenAt);
    if (!Number.isFinite(writtenAtMs)) return null;
    parsed.push({ path, writtenAt: writtenAtMs });
  }
  return { workspaceRoot: workspaceRoot.trim(), writes: parsed };
}

interface AttributableThread {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly envMode?: "local" | "worktree" | undefined;
  readonly worktreePath: string | null;
  readonly workingDirectory?: string | null | undefined;
  readonly deletedAt?: string | null;
  readonly latestTurn: {
    readonly turnId: TurnId;
    readonly requestedAt: string;
    readonly completedAt: string | null;
  } | null;
}

export interface HostWriteAttribution {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly cwd: string;
  readonly paths: ReadonlyArray<string>;
}

/**
 * The turns each write landed in: every thread working in the reported
 * workspace whose latest turn was requested before the write and had not yet
 * ended (with the slack above) when it landed. `sameWorkspace` compares a
 * thread's resolved cwd with the reported root; the route passes a
 * realpath-aware comparison.
 */
export function attributeHostWrites(input: {
  readonly report: LatticeHostFileWrites;
  readonly threads: ReadonlyArray<AttributableThread>;
  readonly projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly kind?: ProjectKind | undefined;
    readonly workspaceRoot: string;
  }>;
  readonly sameWorkspace: (cwd: string) => boolean;
}): HostWriteAttribution[] {
  const attributions: HostWriteAttribution[] = [];
  for (const thread of input.threads) {
    if (thread.deletedAt || !thread.latestTurn) continue;
    const cwd = resolveThreadWorkspaceCwd({ thread, projects: input.projects });
    if (!cwd || !input.sameWorkspace(cwd)) continue;
    const requestedAt = Date.parse(thread.latestTurn.requestedAt);
    const completedAt =
      thread.latestTurn.completedAt === null ? null : Date.parse(thread.latestTurn.completedAt);
    const paths = new Set<string>();
    for (const write of input.report.writes) {
      if (!Number.isFinite(requestedAt) || write.writtenAt < requestedAt) continue;
      if (completedAt !== null && write.writtenAt > completedAt + HOST_WRITE_TURN_END_SLACK_MS) {
        continue;
      }
      paths.add(write.path);
    }
    if (paths.size === 0) continue;
    attributions.push({
      threadId: thread.id,
      turnId: thread.latestTurn.turnId,
      cwd,
      paths: [...paths].toSorted(),
    });
  }
  return attributions;
}

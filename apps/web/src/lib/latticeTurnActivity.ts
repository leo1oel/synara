// FILE: latticeTurnActivity.ts
// Purpose: Build the `synara:turn-activity` message Lattice uses to show the
// agent at work on its canvas, and pace it to the host.
// Layer: Web embed integration logic

import {
  isLocalAbsolutePath,
  isWorkspaceRelativePathSafe,
  workspaceRelativePathOf,
} from "@synara/shared/path";

import { SYNARA_TURN_ACTIVITY, type SynaraTurnActivityMessage } from "../embedMode";
import type { WorkLogEntry } from "../workLog";

/** At most four messages a second reach the host. */
export const TURN_ACTIVITY_MIN_INTERVAL_MS = 250;

const MAX_TOOL_TITLE_LENGTH = 120;
const MAX_TOOL_DETAIL_LENGTH = 160;
const MAX_TOOL_PATHS = 12;

export type TurnActivityWorkLogEntry = Pick<
  WorkLogEntry,
  | "turnId"
  | "tone"
  | "label"
  | "toolTitle"
  | "preview"
  | "command"
  | "changedFiles"
  | "commandActionPaths"
  | "liveActivity"
>;

export interface TurnActivitySnapshot {
  workspaceRoot: string;
  threadId: string;
  turnId: string | null;
  /** The latest turn has started and not settled. */
  turnLive: boolean;
  /** A pending approval or user-input question is open. */
  awaitingInput: boolean;
  provider: { id: string; label: string };
  workLogEntries: ReadonlyArray<TurnActivityWorkLogEntry>;
}

/**
 * Project-relative, forward-slash paths for a tool's file targets. A path
 * outside the workspace, or one that climbs out of it, is dropped rather than
 * shown as something it is not.
 */
export function relativizeToolPaths(paths: ReadonlyArray<string>, workspaceRoot: string): string[] {
  const relative: string[] = [];
  for (const path of paths) {
    const trimmed = path.trim();
    const candidate = isLocalAbsolutePath(trimmed)
      ? workspaceRelativePathOf(trimmed, workspaceRoot)
      : trimmed.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
    if (!candidate || !isWorkspaceRelativePathSafe(candidate) || relative.includes(candidate)) {
      continue;
    }
    relative.push(candidate);
    if (relative.length >= MAX_TOOL_PATHS) break;
  }
  return relative;
}

function boundedLine(value: string | undefined, maximum: number): string | null {
  const line = value?.split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > maximum ? `${line.slice(0, maximum - 1)}…` : line;
}

function currentTool(
  snapshot: TurnActivitySnapshot,
): SynaraTurnActivityMessage["tool"] | undefined {
  if (snapshot.turnId === null) return undefined;
  // Entries are in timeline order and a tool's start, updates and end fold
  // into one entry, so the newest still-running one is the call in flight.
  for (let index = snapshot.workLogEntries.length - 1; index >= 0; index -= 1) {
    const entry = snapshot.workLogEntries[index]!;
    if (
      entry.turnId !== snapshot.turnId ||
      entry.tone !== "tool" ||
      entry.liveActivity?.state !== "running_tool"
    ) {
      continue;
    }
    // Only the read target or the command's first line: an entry's `detail`
    // can carry tool output, which never leaves the panel.
    return {
      title: boundedLine(entry.toolTitle ?? entry.label, MAX_TOOL_TITLE_LENGTH) ?? "Tool call",
      detail: boundedLine(entry.preview ?? entry.command, MAX_TOOL_DETAIL_LENGTH),
      paths: relativizeToolPaths(
        [...(entry.changedFiles ?? []), ...(entry.commandActionPaths ?? [])],
        snapshot.workspaceRoot,
      ),
    };
  }
  return undefined;
}

export function buildTurnActivityMessage(
  snapshot: TurnActivitySnapshot,
): SynaraTurnActivityMessage {
  const state = !snapshot.turnLive ? "idle" : snapshot.awaitingInput ? "waiting" : "running";
  const tool = state === "idle" ? undefined : currentTool(snapshot);
  return {
    type: SYNARA_TURN_ACTIVITY,
    version: 1,
    workspaceRoot: snapshot.workspaceRoot,
    threadId: snapshot.threadId,
    turnId: snapshot.turnId,
    state,
    provider: snapshot.provider,
    ...(tool ? { tool } : {}),
  };
}

function idleMessage(message: SynaraTurnActivityMessage): SynaraTurnActivityMessage {
  const { tool: _tool, ...rest } = message;
  return { ...rest, state: "idle" };
}

export interface TurnActivityReporter {
  /**
   * The panel's current activity, or null once no thread is active here. A
   * repeat of what the host already has is not sent again unless `force`d.
   */
  report(message: SynaraTurnActivityMessage | null, options?: { force?: boolean }): void;
  /**
   * This view stopped reporting `threadId`. If no other view has taken over,
   * the host is told it went idle.
   */
  release(threadId: string): void;
  /** Drop pending messages and timers. */
  dispose(): void;
}

export interface TurnActivityReporterOptions {
  post: (message: SynaraTurnActivityMessage) => void;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Paces turn activity to the host. The first change goes out at once and
 * later ones at most every {@link TURN_ACTIVITY_MIN_INTERVAL_MS}; pending
 * changes for one thread collapse into its latest, so the trailing send is
 * always the current state (the final `idle` included). Leaving a busy thread
 * queues an `idle` for it first, so the host never sticks in `running`.
 */
export function createTurnActivityReporter(
  options: TurnActivityReporterOptions,
): TurnActivityReporter {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let current: SynaraTurnActivityMessage | null = null;
  const pending: SynaraTurnActivityMessage[] = [];
  // What the host will hold for each thread once the queue drains.
  const lastKeyByThread = new Map<string, string>();
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;

  const flush = () => {
    timer = null;
    const next = pending.shift();
    if (!next) return;
    lastSentAt = now();
    options.post(next);
    schedule();
  };

  const schedule = () => {
    if (timer !== null || pending.length === 0) return;
    const wait = lastSentAt + TURN_ACTIVITY_MIN_INTERVAL_MS - now();
    if (wait <= 0) {
      flush();
      return;
    }
    timer = setTimer(flush, wait);
  };

  const enqueue = (message: SynaraTurnActivityMessage, force: boolean) => {
    const key = JSON.stringify(message);
    if (!force && lastKeyByThread.get(message.threadId) === key) return;
    lastKeyByThread.set(message.threadId, key);
    const queued = pending.findIndex((entry) => entry.threadId === message.threadId);
    if (queued >= 0) pending[queued] = message;
    else pending.push(message);
    schedule();
  };

  const report: TurnActivityReporter["report"] = (message, reportOptions) => {
    const previous = current;
    current = message;
    if (previous && previous.state !== "idle" && previous.threadId !== message?.threadId) {
      enqueue(idleMessage(previous), false);
    }
    if (message) enqueue(message, reportOptions?.force === true);
  };

  return {
    report,
    release(threadId) {
      if (current?.threadId === threadId) report(null);
    },
    dispose() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending.length = 0;
    },
  };
}

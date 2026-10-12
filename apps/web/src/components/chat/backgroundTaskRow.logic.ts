// FILE: backgroundTaskRow.logic.ts
// Purpose: Wording for the single transcript row a background task keeps for its
//          whole life ("running 12s" → "finished · 20s") and for the line that
//          groups three or more of them.
// Layer: Web chat presentation helpers
// Exports: describeBackgroundTaskStatus, summarizeBackgroundTaskGroup

import { i18n } from "~/i18n";

import { formatClockElapsed } from "../../session-logic";
import type { WorkLogBackgroundTask } from "../../workLog";

export interface BackgroundTaskStatusDisplay {
  status: WorkLogBackgroundTask["status"];
  // "running", "finished", "failed · exit 1", "stopped".
  label: string;
  // Time the task has run (live) or ran; null when unknown.
  elapsed: string | null;
}

export function describeBackgroundTaskStatus(
  task: Pick<WorkLogBackgroundTask, "status" | "startedAt" | "completedAt" | "exitCode">,
  nowIso: string,
): BackgroundTaskStatusDisplay {
  const elapsed = formatClockElapsed(task.startedAt, task.completedAt ?? nowIso);
  switch (task.status) {
    case "running":
      return { status: task.status, label: i18n._("running"), elapsed };
    case "finished":
      return { status: task.status, label: i18n._("finished"), elapsed };
    case "failed":
      return {
        status: task.status,
        label:
          task.exitCode !== null
            ? i18n._("failed · exit {code}", { code: task.exitCode })
            : i18n._("failed"),
        elapsed,
      };
    case "stopped":
      return { status: task.status, label: i18n._("stopped"), elapsed };
  }
}

const STATUS_ORDER: ReadonlyArray<WorkLogBackgroundTask["status"]> = [
  "running",
  "finished",
  "failed",
  "stopped",
];

// "4 background tasks · 3 finished, 1 stopped".
export function summarizeBackgroundTaskGroup(
  tasks: ReadonlyArray<Pick<WorkLogBackgroundTask, "status">>,
): string {
  const counts = STATUS_ORDER.map(
    (status) => [status, tasks.filter((task) => task.status === status).length] as const,
  ).filter(([, count]) => count > 0);
  const breakdown = counts
    .map(([status, count]) => backgroundTaskStatusCount(status, count))
    .join(i18n._(", "));
  const head =
    tasks.length === 1
      ? i18n._("1 background task")
      : i18n._("{count} background tasks", { count: tasks.length });
  return breakdown ? `${head} · ${breakdown}` : head;
}

function backgroundTaskStatusCount(status: WorkLogBackgroundTask["status"], count: number): string {
  switch (status) {
    case "running":
      return i18n._("{count} running", { count });
    case "finished":
      return i18n._("{count} finished", { count });
    case "failed":
      return i18n._("{count} failed", { count });
    case "stopped":
      return i18n._("{count} stopped", { count });
  }
}

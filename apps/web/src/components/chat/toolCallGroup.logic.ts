// FILE: toolCallGroup.logic.ts
// Purpose: Summarizes a settled run of tool-call work entries into one compact
//          verb label ("Read 2 files, ran 3 commands") plus a failed count for
//          the collapsed tool-group disclosure in the transcript.
// Layer: Web chat presentation helpers
// Exports: MIN_COLLAPSIBLE_TOOL_GROUP_SIZE, workEntryRowCount,
//          multiFileEditLabel, ToolCallSummaryCategory,
//          ToolCallGroupSummary, isSummarizableToolCallEntry,
//          classifyToolCallSummaryCategory, summarizeToolCallGroup

import type { I18n } from "@lingui/core";

import { i18n as appI18n } from "../../i18n";
import { isFileChangeWorkLogEntry, type WorkLogEntry } from "../../session-logic";
import { extractToolArgumentField } from "../../lib/toolArgumentSummary";
import {
  deriveCommandReadTargets,
  deriveReadableCommandDisplay,
  extractWebFetchUrl,
  resolveCommandVisualKind,
} from "../../lib/toolCallLabel";
import { isReasoningUpdateWorkEntry } from "./agentActivity.logic";

// A single tool row collapses into nothing useful; only runs of 2+ rows fold.
export const MIN_COLLAPSIBLE_TOOL_GROUP_SIZE = 2;

// Rows an entry occupies when listed: a file-change call renders one
// "Edited <file>" row per changed file, so one patch can be a whole column.
// Fold thresholds count these rows, not calls.
export function workEntryRowCount(entry: WorkLogEntry): number {
  return isFileChangeWorkLogEntry(entry) ? Math.max(1, entry.changedFiles?.length ?? 0) : 1;
}

// One-line label for a call that would list several edited-file rows.
export function multiFileEditLabel(entry: WorkLogEntry): string | null {
  const rowCount = workEntryRowCount(entry);
  return rowCount > 1 ? capitalizeFirst(summaryPartPhrase(appI18n, "edit", rowCount, true)) : null;
}

export type ToolCallSummaryCategory =
  | "read"
  | "edit"
  | "search"
  | "command"
  | "fetch"
  | "agent"
  | "tool"
  | "other";

export interface ToolCallGroupSummaryPart {
  category: ToolCallSummaryCategory;
  count: number;
}

export interface ToolCallGroupSummary {
  // Verb summary in the order the work happened: "Read 2 files, ran 3 commands".
  label: string;
  parts: ReadonlyArray<ToolCallGroupSummaryPart>;
  // Calls that failed; the row appends `failedLabel` in the error tone.
  failedCount: number;
  failedLabel: string | null;
  entryCount: number;
  // A group with in-flight work must never present itself as settled.
  hasRunningEntry: boolean;
  // The one kind every summarized call shares, or "mixed": the collapsed row
  // wears that kind's glyph instead of borrowing an arbitrary entry's.
  iconCategory: ToolCallSummaryCategory | "mixed";
  // First summarized entry, for kinds whose glyph is per entry (MCP servers,
  // fetched sites).
  iconEntry: WorkLogEntry;
}

// Rich rows (subagent strips, automation cards, thread-creation recaps,
// background tasks) and non-tool tones (errors, approvals, info) must stay
// individually visible, so they never fold into a summary group.
export function isSummarizableToolCallEntry(entry: WorkLogEntry): boolean {
  return (
    (entry.tone === "tool" ||
      (entry.tone === "error" &&
        entry.toolStatus === "failed" &&
        entry.activityKind?.startsWith("tool.") === true)) &&
    !(entry.toolCallId && isReasoningUpdateWorkEntry(entry)) &&
    !entry.synaraThreadCreation &&
    !entry.automation &&
    !entry.subagentAction &&
    !entry.backgroundTask &&
    (entry.subagents?.length ?? 0) === 0
  );
}

const READ_VERBS = new Set(["Read", "Reading"]);
const SEARCH_VERBS = new Set(["Searched", "Searching", "Found", "Finding"]);
// Provider tools that only read or search, named the way Claude and ACP agents
// report them (`Read`, `Grep`, `Glob`, `WebSearch`).
const READ_TOOL_NAMES = new Set(["read", "readfile", "viewfile"]);
const SEARCH_TOOL_NAMES = new Set(["grep", "glob", "websearch", "findfiles", "searchfiles"]);

function normalizedToolName(entry: WorkLogEntry): string {
  return (entry.toolName ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

function classifyCommandVerb(verb: string): ToolCallSummaryCategory {
  if (READ_VERBS.has(verb)) return "read";
  if (SEARCH_VERBS.has(verb)) return "search";
  return "command";
}

export function classifyToolCallSummaryCategory(entry: WorkLogEntry): ToolCallSummaryCategory {
  if (isFileChangeWorkLogEntry(entry)) {
    return "edit";
  }
  const toolName = normalizedToolName(entry);
  if (entry.requestKind === "file-read" || READ_TOOL_NAMES.has(toolName)) {
    return "read";
  }
  if (entry.itemType === "web_search" || SEARCH_TOOL_NAMES.has(toolName)) {
    return "search";
  }
  if (extractWebFetchUrl(entry)) {
    return "fetch";
  }
  if (entry.requestKind === "tool") {
    return "tool";
  }
  const command = entry.command ?? entry.rawCommand;
  if (entry.itemType === "command_execution" || entry.requestKind === "command" || command) {
    if (command) {
      const kind = resolveCommandVisualKind(command);
      return kind === "read" ? "read" : kind === "search" ? "search" : "command";
    }
    // Structured command actions (e.g. Codex read/search) carry the verb as the
    // derived tool title without any shell command string.
    const titleVerb = entry.toolTitle?.trim().split(/\s+/, 1)[0] ?? "";
    return classifyCommandVerb(titleVerb);
  }
  if (entry.itemType === "collab_agent_tool_call") {
    return "agent";
  }
  if (entry.itemType === "mcp_tool_call" || entry.itemType === "dynamic_tool_call") {
    return "tool";
  }
  if (entry.toolName) {
    return "tool";
  }
  return "other";
}

// Distinct-file identity for an edit/read entry. Entries with no file info
// count as one unit each so the total never under-reports work.
function entryFileKeys(entry: WorkLogEntry): ReadonlyArray<string> {
  if (entry.changedFiles && entry.changedFiles.length > 0) {
    return entry.changedFiles;
  }
  const detailFiles = entry.toolDetails?.files;
  if (detailFiles && detailFiles.length > 0) {
    return detailFiles;
  }
  const command = entry.command ?? entry.rawCommand;
  if (command) {
    const readTargets = deriveCommandReadTargets(command);
    if (readTargets) {
      return readTargets;
    }
    const target = deriveReadableCommandDisplay(command).target.trim();
    if (target.length > 0) {
      return [target];
    }
  }
  const argumentPath = entry.detail
    ? extractToolArgumentField(entry.detail, ["file_path", "filePath", "path"], {
        fallbackScan: "whenUnparsed",
      })
    : null;
  if (argumentPath) {
    return [argumentPath];
  }
  if (entry.preview?.trim()) {
    return [entry.preview.trim()];
  }
  return [];
}

// Most groups name two or three kinds; past that the tail folds into one
// "N other actions" part so the line stays readable.
const MAX_NAMED_SUMMARY_PARTS = 3;
const NAMED_PARTS_BEFORE_OVERFLOW = 2;

// Lowercase verb phrase; the label capitalizes only its first part. Each count
// is its own catalog entry so translations need no English plural or case rules.
function summaryPartPhrase(
  i18n: I18n,
  category: ToolCallSummaryCategory,
  count: number,
  isSolePart: boolean,
): string {
  const one = count === 1;
  switch (category) {
    case "read":
      return one ? i18n._("read 1 file") : i18n._("read {count} files", { count });
    case "edit":
      return one ? i18n._("edited 1 file") : i18n._("edited {count} files", { count });
    case "search":
      if (one) return i18n._("searched once");
      if (count === 2) return i18n._("searched twice");
      return i18n._("searched {count} times", { count });
    case "command":
      return one ? i18n._("ran 1 command") : i18n._("ran {count} commands", { count });
    case "fetch":
      return one ? i18n._("fetched 1 page") : i18n._("fetched {count} pages", { count });
    case "agent":
      return one ? i18n._("ran 1 agent task") : i18n._("ran {count} agent tasks", { count });
    case "tool":
      return one ? i18n._("used 1 tool") : i18n._("used {count} tools", { count });
    case "other":
      return isSolePart
        ? one
          ? i18n._("ran 1 tool call")
          : i18n._("ran {count} tool calls", { count })
        : otherActionsPhrase(i18n, count);
  }
}

function otherActionsPhrase(i18n: I18n, count: number): string {
  return count === 1 ? i18n._("1 other action") : i18n._("{count} other actions", { count });
}

function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function joinSummaryParts(i18n: I18n, parts: ReadonlyArray<ToolCallGroupSummaryPart>): string {
  const named =
    parts.length > MAX_NAMED_SUMMARY_PARTS ? parts.slice(0, NAMED_PARTS_BEFORE_OVERFLOW) : parts;
  const overflowCount = parts.slice(named.length).reduce((total, part) => total + part.count, 0);
  const phrases = named.map((part) =>
    summaryPartPhrase(i18n, part.category, part.count, parts.length === 1),
  );
  if (overflowCount > 0) {
    phrases.push(otherActionsPhrase(i18n, overflowCount));
  }
  return capitalizeFirst(phrases.join(i18n._(", ")));
}

export function summarizeToolCallGroup(
  entries: ReadonlyArray<WorkLogEntry>,
  i18n: I18n = appI18n,
): ToolCallGroupSummary | null {
  const summarizable = entries.filter(isSummarizableToolCallEntry);
  const rowCount = summarizable.reduce((total, entry) => total + workEntryRowCount(entry), 0);
  if (rowCount < MIN_COLLAPSIBLE_TOOL_GROUP_SIZE) {
    return null;
  }

  // Map insertion order is first appearance, so parts read in the order the
  // agent did the work.
  const countByCategory = new Map<ToolCallSummaryCategory, number>();
  const distinctFilesByCategory = new Map<ToolCallSummaryCategory, Set<string>>();
  let hasRunningEntry = false;
  let failedCount = 0;

  for (const entry of summarizable) {
    if (entry.toolStatus === "running") {
      hasRunningEntry = true;
    }
    if (entry.toolStatus === "failed") {
      failedCount += 1;
    }
    const category = classifyToolCallSummaryCategory(entry);
    const count = countByCategory.get(category) ?? 0;
    if (category === "edit" || category === "read") {
      const fileKeys = entryFileKeys(entry);
      if (fileKeys.length === 0) {
        countByCategory.set(category, count + 1);
        continue;
      }
      countByCategory.set(category, count);
      const distinctFiles =
        distinctFilesByCategory.get(category) ??
        distinctFilesByCategory.set(category, new Set()).get(category)!;
      for (const fileKey of fileKeys) {
        distinctFiles.add(fileKey);
      }
      continue;
    }
    countByCategory.set(category, count + 1);
  }

  for (const [category, distinctFiles] of distinctFilesByCategory) {
    countByCategory.set(category, (countByCategory.get(category) ?? 0) + distinctFiles.size);
  }

  // "Other" calls always trail the named kinds.
  const parts = [...countByCategory.entries()]
    .filter(([, count]) => count > 0)
    .toSorted(([left], [right]) => Number(left === "other") - Number(right === "other"))
    .map(([category, count]) => ({ category, count }));

  return {
    label: joinSummaryParts(i18n, parts),
    parts,
    failedCount,
    failedLabel: failedCount > 0 ? i18n._("{count} failed", { count: failedCount }) : null,
    entryCount: summarizable.length,
    hasRunningEntry,
    iconCategory: parts.length === 1 ? parts[0]!.category : "mixed",
    iconEntry: summarizable[0]!,
  };
}

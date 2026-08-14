import { createHash } from "node:crypto";

import {
  isToolLifecycleItemType,
  type OrchestrationEvent,
  type ProviderRuntimeEvent,
  type ThreadId,
  type TurnId,
} from "@synara/contracts";

import {
  SYNARA_GATEWAY_HARNESS_POLICY,
  SYNARA_HARNESS_POLICY_VERSION,
  SYNARA_IDENTITY_ONLY_HARNESS_POLICY,
} from "./harnessPolicy.ts";

export const AGENT_QUALITY_TRACE_SCHEMA_VERSION = 1 as const;
export const LATTICE_AGENT_COMPILE_RESULT = "lattice:agent-compile-result" as const;

const TRAILING_LATTICE_CONTEXT_PATTERN =
  /\n*<lattice_active_context version="1">\n([\s\S]*?)\n<\/lattice_active_context>\s*$/u;
const MAX_TRACE_STRING_CHARS = 160;
const MAX_PENDING_THREADS = 1_024;
const MAX_PENDING_ATTEMPTS_PER_THREAD = 64;
const MAX_PENDING_RECORDS_PER_THREAD = 1_024;
const MAX_PENDING_TOOL_ITEMS_PER_THREAD = 1_024;

type JsonRecord = Record<string, unknown>;

export interface LatticeAgentCompileResult {
  readonly type: typeof LATTICE_AGENT_COMPILE_RESULT;
  readonly version: 1;
  readonly threadId: string;
  readonly turnId: string;
  readonly checkpointRef: string;
  readonly compiledAt: string;
  readonly success: boolean;
  readonly durationMs: number | null;
  readonly rootDocument: string | null;
  readonly diagnostics: {
    readonly errors: number;
    readonly warnings: number;
  };
}

export interface AgentQualityTraceRecord extends JsonRecord {
  readonly schemaVersion: typeof AGENT_QUALITY_TRACE_SCHEMA_VERSION;
  readonly type: string;
  readonly recordedAt: string;
  readonly threadId: string;
  readonly turnId: string;
}

interface PendingTurnContext {
  readonly dispatchId: string;
  readonly messageId: string;
  readonly manifest: JsonRecord;
  readonly dispatchStartedAtMs: number;
  turnId?: string;
  failedAtMs?: number;
}

interface PendingStartedTurn {
  readonly event: Extract<ProviderRuntimeEvent, { type: "turn.started" }>;
  readonly records: AgentQualityTraceRecord[];
}

interface PendingToolContext {
  readonly toolName?: string;
  readonly evidenceIds: readonly string[];
  readonly cachedPaperRead: boolean;
}

export interface AgentQualityPendingTurnContext {
  readonly dispatchId: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly messageText: string;
  readonly recordedAt: string;
  readonly dispatchStartedAt: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  const result = typeof value === "string" ? value.trim() : "";
  return result ? result : undefined;
}

function finiteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function canonicalJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : '"[non-finite]"';
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value !== "object") return JSON.stringify(`[${typeof value}]`);
  if (seen.has(value)) return '"[circular]"';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalJson(entry, seen)).join(",")}]`;
    }
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as JsonRecord)[key], seen)}`)
      .join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

export function hashAgentQualityValue(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function estimatedTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function safeRelativePath(value: unknown): string | undefined {
  const path = nonEmptyString(value)?.replaceAll("\\", "/");
  if (
    !path ||
    path.length > 1_024 ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[A-Za-z]:\//u.test(path) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(path) ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    return undefined;
  }
  return path;
}

function safeTraceLabel(value: unknown): string | undefined {
  const label = nonEmptyString(value);
  return label ? label.slice(0, MAX_TRACE_STRING_CHARS) : undefined;
}

function safeTraceIdentifier(value: unknown): string | undefined {
  const identifier = nonEmptyString(value);
  return identifier &&
    identifier.length <= 512 &&
    /^[A-Za-z0-9][A-Za-z0-9._:@/+-]*$/u.test(identifier)
    ? identifier
    : undefined;
}

function strictUtcTimestamp(value: unknown): string | undefined {
  const timestamp = nonEmptyString(value);
  if (
    !timestamp ||
    timestamp.length > 32 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(timestamp)
  ) {
    return undefined;
  }
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) return undefined;
  const canonical = new Date(timestampMs).toISOString();
  return timestamp === canonical || timestamp === canonical.replace(".000Z", "Z")
    ? timestamp
    : undefined;
}

function selectionManifest(value: JsonRecord | undefined): JsonRecord {
  const selection = nonEmptyString(value?.selection);
  const omittedChars = finiteNonNegativeInteger(value?.selectionOmittedChars)
    ? value.selectionOmittedChars
    : 0;
  return {
    selection: selection ? "included" : "absent",
    ...(selection
      ? {
          selectionHash: hashAgentQualityValue(selection),
          selectionChars: selection.length,
          estimatedSelectionTokens: estimatedTokens(selection.length),
        }
      : {}),
    ...(omittedChars > 0 ? { omittedChars } : {}),
  };
}

function contextSources(context: JsonRecord): JsonRecord[] {
  const sources: JsonRecord[] = [];
  const editor = isRecord(context.editor) ? context.editor : undefined;
  const editorPath = safeRelativePath(editor?.path);
  if (editorPath) {
    sources.push({
      source: "editor",
      path: editorPath,
      range: {
        line: finiteNonNegativeInteger(editor?.line) ? Math.max(1, editor.line) : 1,
        column: finiteNonNegativeInteger(editor?.column) ? editor.column : 0,
      },
      ...selectionManifest(editor),
    });
  }

  const pdf = isRecord(context.pdf) ? context.pdf : undefined;
  if (pdf) {
    sources.push({
      source: "pdf",
      range: {
        page: finiteNonNegativeInteger(pdf.page) ? Math.max(1, pdf.page) : 1,
        pageCount: finiteNonNegativeInteger(pdf.pageCount) ? pdf.pageCount : null,
      },
      ...selectionManifest(pdf),
    });
  }

  const paper = isRecord(context.paper) ? context.paper : undefined;
  const paperPath = safeRelativePath(paper?.path);
  if (paper && paperPath) {
    sources.push({
      source: "paper",
      view: paper.view === "blog" ? "blog" : "fulltext",
      ...(nonEmptyString(paper.arxivId)
        ? { sourceIdHash: hashAgentQualityValue(paper.arxivId) }
        : {}),
      ...selectionManifest(paper),
    });
  }
  return sources;
}

function promptContextManifest(text: string, recordedAt: string): JsonRecord {
  const match = TRAILING_LATTICE_CONTEXT_PATTERN.exec(text);
  const visibleText = match ? text.slice(0, match.index).trimEnd() : text;
  let context: JsonRecord | undefined;
  if (match?.[1]) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      if (isRecord(parsed) && parsed.type === "lattice:host-context" && parsed.version === 1) {
        context = parsed;
      }
    } catch {
      // A malformed block is represented as omitted; its content never reaches the trace.
    }
  }
  const capturedAt = nonEmptyString(context?.capturedAt);
  const capturedMs = capturedAt ? Date.parse(capturedAt) : Number.NaN;
  const recordedMs = Date.parse(recordedAt);
  const sources = context ? contextSources(context) : [];
  return {
    stablePrefix: {
      sources: ["host-policy", "provider-tool-catalog"],
      scope: "provider-session",
      policyVersion: SYNARA_HARNESS_POLICY_VERSION,
      policyHashes: {
        gateway: hashAgentQualityValue(SYNARA_GATEWAY_HARNESS_POLICY),
        identityOnly: hashAgentQualityValue(SYNARA_IDENTITY_ONLY_HARNESS_POLICY),
      },
      selectedPolicyHash: null,
      policySelectionOmission: "not-exposed-by-runtime-events",
      toolCatalogHash: null,
      toolCatalogOmission: "not-exposed-by-runtime-events",
    },
    dynamicContext: {
      promptHash: hashAgentQualityValue(visibleText),
      promptChars: visibleText.length,
      estimatedPromptTokens: estimatedTokens(visibleText.length),
      contextHash: context ? hashAgentQualityValue(context) : null,
      sources,
      freshnessMs:
        Number.isFinite(capturedMs) && Number.isFinite(recordedMs)
          ? Math.max(0, recordedMs - capturedMs)
          : null,
      omissions: [
        ...(!context ? ["lattice-context"] : []),
        ...sources
          .filter((source) => typeof source.omittedChars === "number" && source.omittedChars > 0)
          .map((source) => `${source.source}-selection`),
      ],
    },
  };
}

function baseRecord(input: {
  readonly type: string;
  readonly recordedAt: string;
  readonly threadId: string;
  readonly turnId?: string | undefined;
}): AgentQualityTraceRecord {
  return {
    schemaVersion: AGENT_QUALITY_TRACE_SCHEMA_VERSION,
    type: input.type,
    recordedAt: input.recordedAt,
    threadId: input.threadId,
    turnId: input.turnId ?? "unbound",
  };
}

function turnKey(threadId: ThreadId | string, turnId: TurnId | string): string {
  return JSON.stringify([threadId, turnId]);
}

function requestKey(threadId: ThreadId | string, requestId: string): string {
  return JSON.stringify([threadId, requestId]);
}

function normalizeLatticeToolName(value: unknown): string | undefined {
  const name = safeTraceLabel(value);
  if (!name) return undefined;
  const latticeMcp = /(?:^|__|[./])lattice(?:__|[./])([A-Za-z0-9_-]+)$/u.exec(name);
  return latticeMcp?.[1] ?? name;
}

function pathsFromToolData(data: JsonRecord | undefined): string[] {
  const paths = new Set<string>();
  for (const candidate of [data?.path, data?.filePath, data?.file]) {
    const path = safeRelativePath(candidate);
    if (path && !cachedPaperReferenceFromPath(path)) paths.add(path);
  }
  for (const collection of [data?.files, data?.changes]) {
    if (!Array.isArray(collection)) continue;
    for (const entry of collection) {
      const path = safeRelativePath(isRecord(entry) ? entry.path : entry);
      if (path && !cachedPaperReferenceFromPath(path)) paths.add(path);
    }
  }
  return [...paths].toSorted();
}

function cachedPaperReferenceFromPath(value: unknown): string | undefined {
  const path = safeRelativePath(value);
  const paperId = path
    ? /^\.research\/papers\/([^/]+)\/(?:paper|blog)\.md$/u.exec(path)?.[1]
    : undefined;
  return paperId
    ? (canonicalEvidenceReference("arxivId", paperId) ?? `paper:${paperId.toLowerCase()}`)
    : undefined;
}

function canonicalEvidenceReference(key: string, value: unknown): string | undefined {
  const text = nonEmptyString(value);
  if (!text) return undefined;
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === "arxivid" || normalizedKey === "arxiv_id") {
    const match =
      /(?:arxiv(?:\.org\/(?:abs|pdf)\/|:))?([0-9]{4}\.[0-9]{4,5}|[a-z-]+\/[0-9]{7})(?:v[0-9]+)?/iu.exec(
        text,
      );
    return match?.[1] ? `arxiv:${match[1].toLowerCase()}` : undefined;
  }
  if (normalizedKey === "doi") {
    const doi = text.replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "").replace(/^doi:\s*/iu, "");
    return /^10\.\d{4,9}\/\S+$/u.test(doi) ? `doi:${doi.toLowerCase()}` : undefined;
  }
  if (
    ["paperpath", "fulltextpath", "overviewpath", "path", "filepath", "file_path"].includes(
      normalizedKey,
    )
  ) {
    return cachedPaperReferenceFromPath(text);
  }
  if (normalizedKey === "url") {
    try {
      const url = new URL(text);
      if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
      url.hash = "";
      return `url:${url.toString()}`;
    } catch {
      return undefined;
    }
  }
  if (normalizedKey === "query") {
    return (
      canonicalEvidenceReference("arxivId", text) ??
      canonicalEvidenceReference("doi", text) ??
      canonicalEvidenceReference("url", text)
    );
  }
  return undefined;
}

function evidenceFromToolData(data: JsonRecord | undefined): {
  readonly ids: string[];
  readonly cachedPaperRead: boolean;
} {
  const references = new Set<string>();
  let cachedPaperRead = false;
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || references.size >= 32 || !isRecord(value)) return;
    for (const [key, entry] of Object.entries(value)) {
      const reference = canonicalEvidenceReference(key, entry);
      if (reference) references.add(hashAgentQualityValue(reference));
      if (cachedPaperReferenceFromPath(entry)) cachedPaperRead = true;
      if (isRecord(entry)) visit(entry, depth + 1);
      else if (Array.isArray(entry)) {
        for (const item of entry.slice(0, 32)) visit(item, depth + 1);
      }
    }
  };
  visit(data, 0);
  return { ids: [...references].toSorted(), cachedPaperRead };
}

function toolRecord(
  event: Extract<
    ProviderRuntimeEvent,
    { type: "item.started" | "item.updated" | "item.completed" }
  >,
  turnId: string,
  pending?: PendingToolContext,
): AgentQualityTraceRecord | undefined {
  if (!isToolLifecycleItemType(event.payload.itemType)) return undefined;
  const data = isRecord(event.payload.data) ? event.payload.data : undefined;
  // Codex preserves its app-server payload as `{ item: ... }`, while the
  // other adapters expose normalized tool fields at the top level.
  const nestedItem = isRecord(data?.item) ? data.item : undefined;
  const nestedState = isRecord(data?.state) ? data.state : undefined;
  const toolName =
    normalizeLatticeToolName(
      data?.toolName ??
        data?.tool ??
        nestedItem?.toolName ??
        nestedItem?.tool ??
        data?.kind ??
        nestedItem?.kind,
    ) ?? pending?.toolName;
  const input =
    data?.input ??
    data?.rawInput ??
    data?.args ??
    data?.arguments ??
    nestedItem?.input ??
    nestedItem?.rawInput ??
    nestedItem?.args ??
    nestedItem?.arguments;
  const output =
    data?.result ??
    data?.rawOutput ??
    data?.output ??
    data?.structured ??
    data?.content ??
    nestedItem?.result ??
    nestedItem?.rawOutput ??
    nestedItem?.output ??
    nestedItem?.structured ??
    nestedItem?.content ??
    nestedState?.result ??
    nestedState?.output ??
    nestedState?.structured ??
    nestedState?.content;
  const evidence = evidenceFromToolData(data);
  const evidenceIds = [...new Set([...(pending?.evidenceIds ?? []), ...evidence.ids])].toSorted();
  const cachedPaperRead = evidence.cachedPaperRead || pending?.cachedPaperRead === true;
  const failed =
    event.payload.status === "failed" ||
    event.payload.status === "declined" ||
    data?.isError === true ||
    data?.error === true ||
    nestedItem?.isError === true ||
    nestedItem?.error === true ||
    nestedState?.status === "error";
  const status = event.type === "item.completed" ? (failed ? "failed" : "success") : "started";
  const normalizedToolName = (toolName ?? event.payload.itemType).toLowerCase();
  const hasOutput =
    output !== undefined &&
    output !== null &&
    (typeof output !== "string" || output.trim().length > 0) &&
    (!Array.isArray(output) || output.length > 0) &&
    (!isRecord(output) || Object.keys(output).length > 0);
  const fullTextEvidence =
    status === "success" &&
    hasOutput &&
    evidenceIds.length > 0 &&
    (["fetch_paper", "fetch_web_reference", "read_cached_paper", "read_paper"].includes(
      normalizedToolName,
    ) ||
      (["read", "read_file"].includes(normalizedToolName) && cachedPaperRead));
  return {
    ...baseRecord({
      type: "tool",
      recordedAt: event.createdAt,
      threadId: event.threadId,
      turnId,
    }),
    provider: event.provider,
    itemId: event.itemId ?? null,
    tool: {
      name: toolName ?? event.payload.itemType,
      kind: event.payload.itemType,
      phase:
        event.type === "item.started"
          ? "started"
          : event.type === "item.updated"
            ? "updated"
            : "completed",
      status,
      ...(input === undefined ? {} : { inputHash: hashAgentQualityValue(input) }),
      ...(output === undefined ? {} : { outputHash: hashAgentQualityValue(output) }),
      ...(pathsFromToolData(data).length > 0 ? { paths: pathsFromToolData(data) } : {}),
      ...(evidenceIds.length > 0 ? { evidenceIds } : {}),
      ...(fullTextEvidence
        ? {
            evidenceAccess: "fulltext",
            evidenceProvenance: ["read", "read_file"].includes(normalizedToolName)
              ? "normalized-cached-paper-path"
              : "normalized-tool-completion",
          }
        : {}),
    },
  };
}

export function parseLatticeAgentCompileResult(value: unknown): LatticeAgentCompileResult | null {
  if (!isRecord(value) || !isRecord(value.diagnostics)) return null;
  const allowed = new Set([
    "type",
    "version",
    "threadId",
    "turnId",
    "checkpointRef",
    "compiledAt",
    "success",
    "durationMs",
    "rootDocument",
    "diagnostics",
  ]);
  const allowedDiagnostics = new Set(["errors", "warnings"]);
  const threadId = safeTraceIdentifier(value.threadId);
  const turnId = safeTraceIdentifier(value.turnId);
  const checkpointRef = safeTraceIdentifier(value.checkpointRef);
  const compiledAt = strictUtcTimestamp(value.compiledAt);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    Object.keys(value.diagnostics).some((key) => !allowedDiagnostics.has(key)) ||
    value.type !== LATTICE_AGENT_COMPILE_RESULT ||
    value.version !== 1 ||
    !threadId ||
    !turnId ||
    !checkpointRef ||
    !compiledAt ||
    typeof value.success !== "boolean" ||
    !(
      value.durationMs === null ||
      (typeof value.durationMs === "number" &&
        Number.isFinite(value.durationMs) &&
        value.durationMs >= 0)
    ) ||
    !(value.rootDocument === null || safeRelativePath(value.rootDocument) !== undefined) ||
    !finiteNonNegativeInteger(value.diagnostics.errors) ||
    !finiteNonNegativeInteger(value.diagnostics.warnings)
  ) {
    return null;
  }
  return {
    type: LATTICE_AGENT_COMPILE_RESULT,
    version: 1,
    threadId,
    turnId,
    checkpointRef,
    compiledAt,
    success: value.success as boolean,
    durationMs: value.durationMs as number | null,
    rootDocument: value.rootDocument === null ? null : safeRelativePath(value.rootDocument)!,
    diagnostics: {
      errors: value.diagnostics.errors as number,
      warnings: value.diagnostics.warnings as number,
    },
  };
}

export function createAgentQualityTraceProjector() {
  const pendingTurns = new Map<string, PendingTurnContext[]>();
  const pendingStartedTurns = new Map<string, PendingStartedTurn[]>();
  const activeTurnByThread = new Map<string, string>();
  const recoveryTurnByThread = new Map<string, string>();
  const permissionTurnByRequest = new Map<string, string>();
  const pendingToolsByThread = new Map<string, Map<string, PendingToolContext>>();
  const turnStartedAt = new Map<string, number>();
  const firstOutputRecorded = new Set<string>();
  const ttftByTurn = new Map<string, number>();

  const resolveRuntimeTurnId = (event: ProviderRuntimeEvent): string | undefined => {
    if (event.turnId) return event.turnId;
    if ((event.type === "request.opened" || event.type === "request.resolved") && event.requestId) {
      const permissionTurn = permissionTurnByRequest.get(
        requestKey(event.threadId, event.requestId),
      );
      if (permissionTurn) return permissionTurn;
    }
    return (
      activeTurnByThread.get(event.threadId) ??
      pendingStartedTurns.get(event.threadId)?.at(-1)?.event.turnId
    );
  };

  const activeOrPendingTurnId = (threadId: string): string | undefined =>
    activeTurnByThread.get(threadId) ?? pendingStartedTurns.get(threadId)?.at(-1)?.event.turnId;

  const projectDomainEventNow = (event: OrchestrationEvent): AgentQualityTraceRecord[] => {
    switch (event.type) {
      case "thread.turn-interrupt-requested": {
        const turnId = event.payload.turnId ?? activeOrPendingTurnId(event.payload.threadId);
        if (!turnId) return [];
        return [
          {
            ...baseRecord({
              type: "stop",
              recordedAt: event.occurredAt,
              threadId: event.payload.threadId,
              turnId,
            }),
            status: "requested",
          },
        ];
      }
      case "thread.approval-response-requested": {
        const turnId =
          permissionTurnByRequest.get(
            requestKey(event.payload.threadId, event.payload.requestId),
          ) ?? activeOrPendingTurnId(event.payload.threadId);
        if (!turnId) return [];
        return [
          {
            ...baseRecord({
              type: "permission",
              recordedAt: event.occurredAt,
              threadId: event.payload.threadId,
              turnId,
            }),
            requestId: event.payload.requestId,
            status: "resolved",
            decision: safeTraceLabel(event.payload.decision) ?? "unknown",
          },
        ];
      }
      case "thread.turn-diff-completed": {
        return [
          {
            ...baseRecord({
              type: "checkpoint",
              recordedAt: event.occurredAt,
              threadId: event.payload.threadId,
              turnId: event.payload.turnId,
            }),
            checkpointRef: event.payload.checkpointRef,
            checkpointTurnCount: event.payload.checkpointTurnCount,
            status: event.payload.status === "ready" ? "success" : event.payload.status,
            files: event.payload.files.flatMap((file) => {
              const path = safeRelativePath(file.path);
              return path ? [{ path, kind: file.kind }] : [];
            }),
          },
        ];
      }
      case "thread.checkpoint-revert-requested": {
        const turnId = activeOrPendingTurnId(event.payload.threadId) ?? "recovery";
        recoveryTurnByThread.set(event.payload.threadId, turnId);
        return [
          {
            ...baseRecord({
              type: "session",
              recordedAt: event.occurredAt,
              threadId: event.payload.threadId,
              turnId,
            }),
            action: "recovery",
            checkpointTurnCount: event.payload.turnCount,
          },
        ];
      }
      case "thread.reverted": {
        const turnId =
          recoveryTurnByThread.get(event.payload.threadId) ??
          activeOrPendingTurnId(event.payload.threadId) ??
          "recovery";
        recoveryTurnByThread.delete(event.payload.threadId);
        return [
          {
            ...baseRecord({
              type: "session",
              recordedAt: event.occurredAt,
              threadId: event.payload.threadId,
              turnId,
            }),
            action: "recovered",
            checkpointTurnCount: event.payload.turnCount,
          },
        ];
      }
      default:
        return [];
    }
  };

  const startedRecords = (
    event: Extract<ProviderRuntimeEvent, { type: "turn.started" }>,
    pending: PendingTurnContext | undefined,
  ): AgentQualityTraceRecord[] => [
    {
      ...baseRecord({
        type: "turn.context",
        recordedAt: event.createdAt,
        threadId: event.threadId,
        turnId: event.turnId,
      }),
      provider: event.provider,
      messageId: pending?.messageId ?? null,
      ...(pending?.manifest ?? promptContextManifest("", event.createdAt)),
    },
    {
      ...baseRecord({
        type: "turn.started",
        recordedAt: event.createdAt,
        threadId: event.threadId,
        turnId: event.turnId,
      }),
      provider: event.provider,
      model: safeTraceLabel(event.payload.model) ?? null,
    },
  ];

  const releasePendingCorrelation = (threadId: string): AgentQualityTraceRecord[] => {
    const starts = pendingStartedTurns.get(threadId) ?? [];
    pendingStartedTurns.delete(threadId);
    pendingTurns.delete(threadId);
    return starts.flatMap((start) => [...startedRecords(start.event, undefined), ...start.records]);
  };

  const prepareTurnContext = (input: AgentQualityPendingTurnContext): AgentQualityTraceRecord[] => {
    const released: AgentQualityTraceRecord[] = [];
    if (!pendingTurns.has(input.threadId) && pendingTurns.size >= MAX_PENDING_THREADS) {
      const oldestThreadId = pendingTurns.keys().next().value;
      if (oldestThreadId !== undefined) {
        released.push(...releasePendingCorrelation(oldestThreadId));
      }
    }
    let queue = pendingTurns.get(input.threadId) ?? [];
    if (queue.length >= MAX_PENDING_ATTEMPTS_PER_THREAD) {
      // A provider that never returns or publishes a start must not grow this
      // state forever. Flush any observed turns without a context rather than
      // silently dropping a start or guessing which crowded attempt owned it.
      released.push(...releasePendingCorrelation(input.threadId));
      queue = [];
    }
    const dispatchStartedAtMs = Date.parse(input.dispatchStartedAt);
    queue.push({
      dispatchId: input.dispatchId,
      messageId: input.messageId,
      manifest: promptContextManifest(input.messageText, input.recordedAt),
      dispatchStartedAtMs: Number.isFinite(dispatchStartedAtMs) ? dispatchStartedAtMs : Date.now(),
    });
    pendingTurns.set(input.threadId, queue);
    return released;
  };

  const cleanupFailedContexts = (threadId: string, throughMs: number): void => {
    if (!Number.isFinite(throughMs)) return;
    const queue = pendingTurns.get(threadId);
    if (!queue) return;
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const failedAtMs = queue[index]?.failedAtMs;
      if (failedAtMs !== undefined && failedAtMs <= throughMs) queue.splice(index, 1);
    }
    if (queue.length === 0) pendingTurns.delete(threadId);
  };

  const resolveStartedContext = (
    event: Extract<ProviderRuntimeEvent, { type: "turn.started" }>,
  ): { readonly wait: true } | { readonly wait: false; readonly pending?: PendingTurnContext } => {
    const eventAtMs = Date.parse(event.createdAt);
    const queue = pendingTurns.get(event.threadId) ?? [];
    const boundIndex = queue.findIndex((candidate) => candidate.turnId === event.turnId);
    let selectedIndex = boundIndex;
    if (selectedIndex < 0) {
      if (Number.isFinite(eventAtMs)) {
        const matchingIndexes = queue.flatMap((candidate, index) =>
          candidate.turnId === undefined &&
          candidate.dispatchStartedAtMs <= eventAtMs &&
          (candidate.failedAtMs === undefined || eventAtMs <= candidate.failedAtMs)
            ? [index]
            : [],
        );
        if (matchingIndexes.some((index) => queue[index]?.failedAtMs === undefined)) {
          return { wait: true };
        }
        selectedIndex = matchingIndexes[0] ?? -1;
      } else {
        const activeIndex = queue.findIndex(
          (candidate) => candidate.turnId === undefined && candidate.failedAtMs === undefined,
        );
        if (activeIndex >= 0) return { wait: true };
      }
    }
    const pending = selectedIndex >= 0 ? queue.splice(selectedIndex, 1)[0] : undefined;
    if (queue.length > 0) pendingTurns.set(event.threadId, queue);
    else pendingTurns.delete(event.threadId);
    return pending ? { wait: false, pending } : { wait: false };
  };

  const drainStartedEvents = (threadId: string): AgentQualityTraceRecord[] => {
    const starts = pendingStartedTurns.get(threadId) ?? [];
    const remaining: typeof starts = [];
    const records: AgentQualityTraceRecord[] = [];
    for (let index = 0; index < starts.length; index += 1) {
      const start = starts[index]!;
      const resolved = resolveStartedContext(start.event);
      if (resolved.wait) {
        remaining.push(...starts.slice(index));
        break;
      }
      records.push(...startedRecords(start.event, resolved.pending), ...start.records);
    }
    if (remaining.length > 0) pendingStartedTurns.set(threadId, remaining);
    else {
      pendingStartedTurns.delete(threadId);
      const latestEventAtMs = Math.max(...starts.map((start) => Date.parse(start.event.createdAt)));
      cleanupFailedContexts(threadId, latestEventAtMs);
    }
    return records;
  };

  const deferRecordsForPendingStart = (
    records: AgentQualityTraceRecord[],
  ): AgentQualityTraceRecord[] => {
    if (records.length === 0) return records;
    const threadIds = new Set(records.map((record) => record.threadId));
    const pendingRecordCount = [...threadIds].reduce(
      (count, threadId) =>
        count +
        (pendingStartedTurns
          .get(threadId)
          ?.reduce((threadCount, start) => threadCount + start.records.length, 0) ?? 0),
      0,
    );
    if (pendingRecordCount + records.length > MAX_PENDING_RECORDS_PER_THREAD) {
      return [
        ...[...threadIds].flatMap((threadId) => releasePendingCorrelation(threadId)),
        ...records,
      ];
    }

    const immediate: AgentQualityTraceRecord[] = [];
    for (const record of records) {
      const start = pendingStartedTurns
        .get(record.threadId)
        ?.find((candidate) => candidate.event.turnId === record.turnId);
      if (start) start.records.push(record);
      else immediate.push(record);
    }
    return immediate;
  };

  const projectDomainEvent = (event: OrchestrationEvent): AgentQualityTraceRecord[] =>
    deferRecordsForPendingStart(projectDomainEventNow(event));

  const clearPendingThread = (threadId: string): AgentQualityTraceRecord[] => {
    const records = releasePendingCorrelation(threadId);
    pendingTurns.delete(threadId);
    return records;
  };

  const bindTurnContext = (input: {
    readonly threadId: string;
    readonly dispatchId: string;
    readonly turnId: string;
  }): AgentQualityTraceRecord[] => {
    const candidate = pendingTurns
      .get(input.threadId)
      ?.find((pending) => pending.dispatchId === input.dispatchId);
    if (candidate) candidate.turnId = input.turnId;
    return drainStartedEvents(input.threadId);
  };

  const failTurnContext = (input: {
    readonly threadId: string;
    readonly dispatchId: string;
    readonly failedAt: string;
  }): AgentQualityTraceRecord[] => {
    const queue = pendingTurns.get(input.threadId);
    if (!queue) return drainStartedEvents(input.threadId);
    const failedAtMs = Date.parse(input.failedAt);
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const candidate = queue[index];
      if (candidate?.dispatchId !== input.dispatchId) continue;
      candidate.failedAtMs = Number.isFinite(failedAtMs) ? failedAtMs : Date.now();
      break;
    }
    return drainStartedEvents(input.threadId);
  };

  const projectRuntimeEventNow = (event: ProviderRuntimeEvent): AgentQualityTraceRecord[] => {
    if (event.type === "turn.started" && event.turnId) {
      const turnId = event.turnId;
      activeTurnByThread.set(event.threadId, turnId);
      const eventAtMs = Date.parse(event.createdAt);
      turnStartedAt.set(turnKey(event.threadId, turnId), eventAtMs);
      const resolved = resolveStartedContext(event);
      if (!resolved.wait) {
        cleanupFailedContexts(event.threadId, eventAtMs);
        return startedRecords(event, resolved.pending);
      }
      let starts = pendingStartedTurns.get(event.threadId) ?? [];
      if (starts.length >= MAX_PENDING_ATTEMPTS_PER_THREAD) {
        const released = releasePendingCorrelation(event.threadId);
        return [...released, ...startedRecords(event, undefined)];
      }
      starts = [...starts, { event, records: [] }];
      pendingStartedTurns.set(event.threadId, starts);
      return [];
    }

    const turnId = resolveRuntimeTurnId(event);
    if (!turnId) {
      if (event.type === "session.started" || event.type === "session.exited") {
        return [
          {
            ...baseRecord({
              type: "session",
              recordedAt: event.createdAt,
              threadId: event.threadId,
            }),
            action: event.type === "session.started" ? "start" : "exit",
            provider: event.provider,
            ...(event.type === "session.started"
              ? { resumed: event.payload.resume !== undefined }
              : { recoverable: event.payload.recoverable ?? null }),
          },
        ];
      }
      return [];
    }

    if (
      event.type === "content.delta" &&
      event.payload.streamKind === "assistant_text" &&
      event.payload.delta.length > 0
    ) {
      const key = turnKey(event.threadId, turnId);
      if (firstOutputRecorded.has(key)) return [];
      firstOutputRecorded.add(key);
      const startedAt = turnStartedAt.get(key);
      const outputAt = Date.parse(event.createdAt);
      const ttftMs =
        startedAt !== undefined && Number.isFinite(outputAt)
          ? Math.max(0, outputAt - startedAt)
          : null;
      if (ttftMs !== null) ttftByTurn.set(key, ttftMs);
      return [
        {
          ...baseRecord({
            type: "turn.first-output",
            recordedAt: event.createdAt,
            threadId: event.threadId,
            turnId,
          }),
          provider: event.provider,
          ttftMs,
        },
      ];
    }

    if (
      event.type === "item.started" ||
      event.type === "item.updated" ||
      event.type === "item.completed"
    ) {
      const itemKey = event.itemId ? turnKey(turnId, event.itemId) : undefined;
      const threadTools = pendingToolsByThread.get(event.threadId) ?? new Map();
      const pending = itemKey ? threadTools.get(itemKey) : undefined;
      const record = toolRecord(event, turnId, pending);
      if (itemKey && event.type !== "item.completed" && record) {
        const tool = isRecord(record.tool) ? record.tool : undefined;
        const recordName = nonEmptyString(tool?.name);
        const data = isRecord(event.payload.data) ? event.payload.data : undefined;
        const evidence = evidenceFromToolData(data);
        if (threadTools.size >= MAX_PENDING_TOOL_ITEMS_PER_THREAD && !threadTools.has(itemKey)) {
          const oldestKey = threadTools.keys().next().value;
          if (oldestKey !== undefined) threadTools.delete(oldestKey);
        }
        threadTools.set(itemKey, {
          ...(recordName && recordName !== event.payload.itemType
            ? { toolName: recordName }
            : pending?.toolName
              ? { toolName: pending.toolName }
              : {}),
          evidenceIds: [...new Set([...(pending?.evidenceIds ?? []), ...evidence.ids])].toSorted(),
          cachedPaperRead: evidence.cachedPaperRead || pending?.cachedPaperRead === true,
        });
        if (
          !pendingToolsByThread.has(event.threadId) &&
          pendingToolsByThread.size >= MAX_PENDING_THREADS
        ) {
          const oldestThreadId = pendingToolsByThread.keys().next().value;
          if (oldestThreadId !== undefined) pendingToolsByThread.delete(oldestThreadId);
        }
        pendingToolsByThread.set(event.threadId, threadTools);
      } else if (itemKey && event.type === "item.completed") {
        threadTools.delete(itemKey);
        if (threadTools.size === 0) pendingToolsByThread.delete(event.threadId);
      }
      return record ? [record] : [];
    }

    if (event.type === "request.opened" || event.type === "request.resolved") {
      if (event.requestId) {
        const key = requestKey(event.threadId, event.requestId);
        if (event.type === "request.opened") permissionTurnByRequest.set(key, turnId);
        else permissionTurnByRequest.delete(key);
      }
      return [
        {
          ...baseRecord({
            type: "permission",
            recordedAt: event.createdAt,
            threadId: event.threadId,
            turnId,
          }),
          provider: event.provider,
          requestId: event.requestId ?? null,
          requestType: event.payload.requestType,
          status: event.type === "request.opened" ? "requested" : "resolved",
          ...(event.type === "request.resolved"
            ? { decision: safeTraceLabel(event.payload.decision) ?? "unknown" }
            : {}),
        },
      ];
    }

    if (event.type === "thread.token-usage.updated") {
      const usage = event.payload.usage;
      const cacheRead =
        usage.lastCacheReadInputTokens ??
        usage.cacheReadInputTokens ??
        usage.lastCachedInputTokens ??
        usage.cachedInputTokens;
      const cacheWrite = usage.lastCacheWriteInputTokens ?? usage.cacheWriteInputTokens;
      return [
        {
          ...baseRecord({
            type: "usage",
            recordedAt: event.createdAt,
            threadId: event.threadId,
            turnId,
          }),
          provider: event.provider,
          tokens: {
            input: usage.lastInputTokens ?? usage.inputTokens ?? null,
            output: usage.lastOutputTokens ?? usage.outputTokens ?? null,
            reasoning: usage.lastReasoningOutputTokens ?? usage.reasoningOutputTokens ?? null,
          },
          cache: {
            readTokens: cacheRead ?? null,
            writeTokens: cacheWrite ?? null,
            readReported: cacheRead !== undefined,
            writeReported: cacheWrite !== undefined,
          },
        },
      ];
    }

    if (event.type === "turn.completed" || event.type === "turn.aborted") {
      const key = turnKey(event.threadId, turnId);
      const startedAt = turnStartedAt.get(key);
      const completedAt = Date.parse(event.createdAt);
      const ttftMs = ttftByTurn.get(key);
      turnStartedAt.delete(key);
      firstOutputRecorded.delete(key);
      ttftByTurn.delete(key);
      const threadTools = pendingToolsByThread.get(event.threadId);
      if (threadTools) {
        const turnPrefix = `[${JSON.stringify(turnId)},`;
        for (const itemKey of threadTools.keys()) {
          if (itemKey.startsWith(turnPrefix)) threadTools.delete(itemKey);
        }
        if (threadTools.size === 0) pendingToolsByThread.delete(event.threadId);
      }
      if (activeTurnByThread.get(event.threadId) === turnId) {
        activeTurnByThread.delete(event.threadId);
      }
      return [
        {
          ...baseRecord({
            type: "turn.completed",
            recordedAt: event.createdAt,
            threadId: event.threadId,
            turnId,
          }),
          provider: event.provider,
          status:
            event.type === "turn.aborted" || event.payload.state === "interrupted"
              ? "stopped"
              : event.payload.state,
          durationMs:
            startedAt !== undefined && Number.isFinite(completedAt)
              ? Math.max(0, completedAt - startedAt)
              : null,
          ttftMs: ttftMs ?? null,
          ttftReported: ttftMs !== undefined,
          cost:
            event.type === "turn.completed"
              ? {
                  turnUsd: event.payload.totalCostUsd ?? null,
                  sessionUsd: event.payload.cumulativeCostUsd ?? null,
                  turnReported: event.payload.totalCostUsd !== undefined,
                  sessionReported: event.payload.cumulativeCostUsd !== undefined,
                }
              : {
                  turnUsd: null,
                  sessionUsd: null,
                  turnReported: false,
                  sessionReported: false,
                },
        },
      ];
    }

    if (event.type === "session.started" || event.type === "session.exited") {
      return [
        {
          ...baseRecord({
            type: "session",
            recordedAt: event.createdAt,
            threadId: event.threadId,
            turnId,
          }),
          action: event.type === "session.started" ? "start" : "exit",
          provider: event.provider,
          ...(event.type === "session.started"
            ? { resumed: event.payload.resume !== undefined }
            : { recoverable: event.payload.recoverable ?? null }),
        },
      ];
    }

    return [];
  };

  const projectRuntimeEvent = (event: ProviderRuntimeEvent): AgentQualityTraceRecord[] => {
    const records = projectRuntimeEventNow(event);
    if (event.type === "session.exited") {
      pendingToolsByThread.delete(event.threadId);
      return [...clearPendingThread(event.threadId), ...records];
    }
    return deferRecordsForPendingStart(records);
  };

  const projectCompileResult = (result: LatticeAgentCompileResult): AgentQualityTraceRecord => ({
    ...baseRecord({
      type: "compile",
      recordedAt: result.compiledAt,
      threadId: result.threadId,
      turnId: result.turnId,
    }),
    checkpointRef: result.checkpointRef,
    success: result.success,
    durationMs: result.durationMs,
    rootDocument: result.rootDocument,
    diagnostics: result.diagnostics,
  });

  return {
    prepareTurnContext,
    bindTurnContext,
    failTurnContext,
    projectDomainEvent,
    projectRuntimeEvent,
    projectCompileResult,
  };
}

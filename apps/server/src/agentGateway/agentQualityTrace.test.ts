import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OrchestrationEvent, ProviderRuntimeEvent } from "@synara/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createPrivateRotatingWriter } from "./Layers/AgentQualityTrace.ts";
import {
  createAgentQualityTraceProjector,
  LATTICE_AGENT_COMPILE_RESULT,
  parseLatticeAgentCompileResult,
} from "./agentQualityTrace.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function domainEvent(value: unknown): OrchestrationEvent {
  return value as OrchestrationEvent;
}

function runtimeEvent(value: unknown): ProviderRuntimeEvent {
  return value as ProviderRuntimeEvent;
}

describe("agent quality trace", () => {
  it("correlates context, tools, cache, TTFT, cost and checkpoints without content", () => {
    const projector = createAgentQualityTraceProjector();
    const threadId = "thread-1";
    const turnId = "turn-1";
    const sensitive = {
      prompt: "PROMPT_SECRET_8a2f",
      selection: "SELECTION_SECRET_5c4e",
      paper: "PAPER_FULL_TEXT_SECRET_1d9b",
      toolInput: "TOOL_INPUT_SECRET_7f3a",
      toolOutput: "TOOL_OUTPUT_SECRET_6e2c",
      toolTitle: "TOOL_TITLE_SECRET_2a8d",
      toolDataName: "TOOL_DATA_NAME_SECRET_4b1c",
      workspace: "/Users/researcher/private-project",
      paperId: "2401.00001",
    };
    const context = {
      type: "lattice:host-context",
      version: 1,
      capturedAt: "2026-08-14T09:59:59.750Z",
      workspaceRoot: sensitive.workspace,
      activeSurface: "paper",
      paper: {
        title: sensitive.paper,
        arxivId: sensitive.paperId,
        path: `.research/papers/${sensitive.paperId}/paper.md`,
        view: "fulltext",
        selection: sensitive.selection,
        selectionOmittedChars: 12,
      },
    };
    projector.prepareTurnContext({
      dispatchId: "dispatch-1",
      threadId,
      messageId: "message-1",
      messageText: `${sensitive.prompt}\n<lattice_active_context version="1">\n${JSON.stringify(context)}\n</lattice_active_context>`,
      recordedAt: "2026-08-14T10:00:00.010Z",
      dispatchStartedAt: "2026-08-14T10:00:00.020Z",
    });
    projector.bindTurnContext({ threadId, dispatchId: "dispatch-1", turnId });
    const records = [
      ...projector.projectDomainEvent(
        domainEvent({
          type: "thread.message-sent",
          occurredAt: "2026-08-14T10:00:00.000Z",
          payload: {
            threadId,
            messageId: "message-1",
            role: "user",
            text: `${sensitive.prompt}\n<lattice_active_context version="1">\n${JSON.stringify(context)}\n</lattice_active_context>`,
          },
        }),
      ),
      ...projector.projectDomainEvent(
        domainEvent({
          type: "thread.turn-start-requested",
          occurredAt: "2026-08-14T10:00:00.010Z",
          payload: { threadId, messageId: "message-1" },
        }),
      ),
      ...projector.projectRuntimeEvent(
        runtimeEvent({
          type: "turn.started",
          provider: "claudeAgent",
          createdAt: "2026-08-14T10:00:00.100Z",
          threadId,
          turnId,
          payload: { model: "claude-sonnet" },
        }),
      ),
      ...projector.projectRuntimeEvent(
        runtimeEvent({
          type: "content.delta",
          provider: "claudeAgent",
          createdAt: "2026-08-14T10:00:00.350Z",
          threadId,
          turnId,
          payload: { streamKind: "assistant_text", delta: sensitive.paper },
        }),
      ),
      ...projector.projectRuntimeEvent(
        runtimeEvent({
          type: "item.completed",
          provider: "claudeAgent",
          createdAt: "2026-08-14T10:00:00.500Z",
          threadId,
          turnId,
          itemId: "item-1",
          payload: {
            itemType: "mcp_tool_call",
            status: "completed",
            title: sensitive.toolTitle,
            data: {
              toolName: "mcp__lattice__fetch_paper",
              input: { arxivId: "2401.00001", query: sensitive.toolInput },
              result: { content: sensitive.toolOutput },
            },
          },
        }),
      ),
      ...projector.projectRuntimeEvent(
        runtimeEvent({
          type: "thread.token-usage.updated",
          provider: "claudeAgent",
          createdAt: "2026-08-14T10:00:00.600Z",
          threadId,
          turnId,
          payload: {
            usage: {
              lastInputTokens: 80,
              lastOutputTokens: 20,
              lastCacheReadInputTokens: 50,
              lastCacheWriteInputTokens: 10,
            },
          },
        }),
      ),
      ...projector.projectRuntimeEvent(
        runtimeEvent({
          type: "item.completed",
          provider: "claudeAgent",
          createdAt: "2026-08-14T10:00:00.650Z",
          threadId,
          turnId,
          itemId: "item-content-bearing-name",
          payload: {
            itemType: "mcp_tool_call",
            status: "completed",
            title: sensitive.toolTitle,
            data: { name: sensitive.toolDataName },
          },
        }),
      ),
      ...projector.projectDomainEvent(
        domainEvent({
          type: "thread.turn-diff-completed",
          occurredAt: "2026-08-14T10:00:00.700Z",
          payload: {
            threadId,
            turnId,
            checkpointRef: "refs/synara/checkpoints/1",
            checkpointTurnCount: 1,
            status: "ready",
            files: [{ path: "main.tex", kind: "modified" }],
          },
        }),
      ),
      ...projector.projectRuntimeEvent(
        runtimeEvent({
          type: "turn.completed",
          provider: "claudeAgent",
          createdAt: "2026-08-14T10:00:01.100Z",
          threadId,
          turnId,
          payload: { state: "completed", totalCostUsd: 0.01, cumulativeCostUsd: 0.03 },
        }),
      ),
    ];

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "turn.context",
          stablePrefix: expect.objectContaining({
            policyHashes: {
              gateway: expect.stringMatching(/^[a-f0-9]{64}$/),
              identityOnly: expect.stringMatching(/^[a-f0-9]{64}$/),
            },
            selectedPolicyHash: null,
            policySelectionOmission: "not-exposed-by-runtime-events",
            toolCatalogHash: null,
            toolCatalogOmission: "not-exposed-by-runtime-events",
          }),
        }),
        expect.objectContaining({
          type: "turn.first-output",
          ttftMs: 250,
        }),
        expect.objectContaining({
          type: "tool",
          tool: expect.objectContaining({
            name: "fetch_paper",
            status: "success",
            inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            outputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        }),
        expect.objectContaining({
          type: "usage",
          cache: {
            readTokens: 50,
            writeTokens: 10,
            readReported: true,
            writeReported: true,
          },
        }),
        expect.objectContaining({
          type: "turn.completed",
          ttftMs: 250,
          ttftReported: true,
          cost: {
            turnUsd: 0.01,
            sessionUsd: 0.03,
            turnReported: true,
            sessionReported: true,
          },
        }),
        expect.objectContaining({
          type: "checkpoint",
          checkpointRef: "refs/synara/checkpoints/1",
          files: [{ path: "main.tex", kind: "modified" }],
        }),
      ]),
    );
    const serialized = JSON.stringify(records);
    for (const value of Object.values(sensitive)) expect(serialized).not.toContain(value);
    expect(serialized).not.toContain("<lattice_active_context");
  });

  it("marks provider omissions instead of claiming unavailable cache, cost, or TTFT", () => {
    const projector = createAgentQualityTraceProjector();
    projector.projectRuntimeEvent(
      runtimeEvent({
        type: "turn.started",
        provider: "codex",
        createdAt: "2026-08-14T10:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {},
      }),
    );
    const usage = projector.projectRuntimeEvent(
      runtimeEvent({
        type: "thread.token-usage.updated",
        provider: "codex",
        createdAt: "2026-08-14T10:00:00.500Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { usage: { inputTokens: 10, outputTokens: 2 } },
      }),
    );
    const completed = projector.projectRuntimeEvent(
      runtimeEvent({
        type: "turn.completed",
        provider: "codex",
        createdAt: "2026-08-14T10:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { state: "completed" },
      }),
    );
    expect(usage[0]).toMatchObject({
      cache: { readTokens: null, writeTokens: null, readReported: false, writeReported: false },
    });
    expect(completed[0]).toMatchObject({
      ttftMs: null,
      ttftReported: false,
      cost: { turnReported: false, sessionReported: false },
    });

    const legacyCache = projector.projectRuntimeEvent(
      runtimeEvent({
        type: "thread.token-usage.updated",
        provider: "codex",
        createdAt: "2026-08-14T10:00:01.100Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { usage: { cachedInputTokens: 7, lastCachedInputTokens: 3 } },
      }),
    );
    expect(legacyCache[0]).toMatchObject({
      cache: { readTokens: 3, writeTokens: null, readReported: true, writeReported: false },
    });
  });

  it("prepares context at provider dispatch so late domain delivery cannot poison the next turn", () => {
    const projector = createAgentQualityTraceProjector();
    projector.prepareTurnContext({
      dispatchId: "dispatch-1",
      threadId: "thread-1",
      messageId: "message-1",
      messageText: "first prompt",
      recordedAt: "2026-08-14T10:00:00.000Z",
      dispatchStartedAt: "2026-08-14T10:00:00.010Z",
    });
    projector.bindTurnContext({
      threadId: "thread-1",
      dispatchId: "dispatch-1",
      turnId: "turn-1",
    });
    const first = projector.projectRuntimeEvent(
      runtimeEvent({
        type: "turn.started",
        provider: "codex",
        createdAt: "2026-08-14T10:00:00.100Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {},
      }),
    );
    expect(first[0]).toMatchObject({ type: "turn.context", messageId: "message-1" });

    // These events are observed on an independent hot stream and may arrive
    // after turn.started. They are deliberately not used for correlation.
    projector.projectDomainEvent(
      domainEvent({
        type: "thread.message-sent",
        occurredAt: "2026-08-14T10:00:00.000Z",
        payload: { threadId: "thread-1", messageId: "message-1", role: "user", text: "first" },
      }),
    );
    projector.projectDomainEvent(
      domainEvent({
        type: "thread.turn-start-requested",
        occurredAt: "2026-08-14T10:00:00.010Z",
        payload: { threadId: "thread-1", messageId: "message-1" },
      }),
    );

    projector.prepareTurnContext({
      dispatchId: "dispatch-2",
      threadId: "thread-1",
      messageId: "message-2",
      messageText: "second prompt",
      recordedAt: "2026-08-14T10:00:01.000Z",
      dispatchStartedAt: "2026-08-14T10:00:01.010Z",
    });
    projector.bindTurnContext({
      threadId: "thread-1",
      dispatchId: "dispatch-2",
      turnId: "turn-2",
    });
    const second = projector.projectRuntimeEvent(
      runtimeEvent({
        type: "turn.started",
        provider: "codex",
        createdAt: "2026-08-14T10:00:01.100Z",
        threadId: "thread-1",
        turnId: "turn-2",
        payload: {},
      }),
    );
    expect(second[0]).toMatchObject({ type: "turn.context", messageId: "message-2" });
  });

  it("correlates delayed starts across failed dispatches and retries by dispatch window", () => {
    const projector = createAgentQualityTraceProjector();
    const prepare = (dispatchId: string, messageId: string, dispatchStartedAt: string) =>
      projector.prepareTurnContext({
        dispatchId,
        threadId: "thread-1",
        messageId,
        messageText: `${messageId} prompt`,
        recordedAt: dispatchStartedAt,
        dispatchStartedAt,
      });
    const start = (turnId: string, createdAt: string) =>
      projector.projectRuntimeEvent(
        runtimeEvent({
          type: "turn.started",
          provider: "claudeAgent",
          createdAt,
          threadId: "thread-1",
          turnId,
          payload: {},
        }),
      )[0];

    prepare("dispatch-a1", "message-a", "2026-08-14T10:00:00.010Z");
    projector.failTurnContext({
      threadId: "thread-1",
      dispatchId: "dispatch-a1",
      failedAt: "2026-08-14T10:00:00.200Z",
    });
    prepare("dispatch-a2", "message-a", "2026-08-14T10:00:00.300Z");
    expect(start("turn-a1", "2026-08-14T10:00:00.100Z")).toMatchObject({ messageId: "message-a" });
    projector.bindTurnContext({
      threadId: "thread-1",
      dispatchId: "dispatch-a2",
      turnId: "turn-a2",
    });
    expect(start("turn-a2", "2026-08-14T10:00:00.400Z")).toMatchObject({ messageId: "message-a" });

    prepare("dispatch-failed", "message-failed", "2026-08-14T10:00:01.000Z");
    projector.failTurnContext({
      threadId: "thread-1",
      dispatchId: "dispatch-failed",
      failedAt: "2026-08-14T10:00:01.100Z",
    });
    prepare("dispatch-b", "message-b", "2026-08-14T10:00:01.200Z");
    projector.bindTurnContext({
      threadId: "thread-1",
      dispatchId: "dispatch-b",
      turnId: "turn-b",
    });
    expect(start("turn-b", "2026-08-14T10:00:01.300Z")).toMatchObject({ messageId: "message-b" });
  });

  it("uses returned turn ids for overlapping attempts and includes same-millisecond failures", () => {
    const projector = createAgentQualityTraceProjector();
    const prepare = (dispatchId: string, messageId: string, dispatchStartedAt: string) =>
      projector.prepareTurnContext({
        dispatchId,
        threadId: "thread-1",
        messageId,
        messageText: `${messageId} prompt`,
        recordedAt: dispatchStartedAt,
        dispatchStartedAt,
      });
    const start = (turnId: string, createdAt: string) =>
      projector.projectRuntimeEvent(
        runtimeEvent({
          type: "turn.started",
          provider: "claudeAgent",
          createdAt,
          threadId: "thread-1",
          turnId,
          payload: {},
        }),
      )[0];

    prepare("dispatch-a", "message-a", "2026-08-14T10:00:00.000Z");
    projector.bindTurnContext({ threadId: "thread-1", dispatchId: "dispatch-a", turnId: "turn-a" });
    prepare("dispatch-b", "message-b", "2026-08-14T10:00:00.100Z");
    projector.bindTurnContext({ threadId: "thread-1", dispatchId: "dispatch-b", turnId: "turn-b" });
    expect(start("turn-b", "2026-08-14T10:00:00.200Z")).toMatchObject({ messageId: "message-b" });
    expect(start("turn-a", "2026-08-14T10:00:00.050Z")).toMatchObject({ messageId: "message-a" });

    prepare("dispatch-c", "message-c", "2026-08-14T10:00:01.000Z");
    projector.failTurnContext({
      threadId: "thread-1",
      dispatchId: "dispatch-c",
      failedAt: "2026-08-14T10:00:01.100Z",
    });
    expect(start("turn-c", "2026-08-14T10:00:01.100Z")).toMatchObject({ messageId: "message-c" });

    prepare("dispatch-failed", "message-failed", "2026-08-14T10:00:02.000Z");
    projector.failTurnContext({
      threadId: "thread-1",
      dispatchId: "dispatch-failed",
      failedAt: "2026-08-14T10:00:02.100Z",
    });
    prepare("dispatch-retry", "message-retry", "2026-08-14T10:00:02.100Z");
    expect(start("turn-retry", "2026-08-14T10:00:02.100Z")).toBeUndefined();
    const retryRecords = projector.bindTurnContext({
      threadId: "thread-1",
      dispatchId: "dispatch-retry",
      turnId: "turn-retry",
    });
    expect(retryRecords[0]).toMatchObject({
      messageId: "message-retry",
    });

    prepare("dispatch-old", "message-old", "2026-08-14T10:00:03.000Z");
    projector.failTurnContext({
      threadId: "thread-1",
      dispatchId: "dispatch-old",
      failedAt: "2026-08-14T10:00:03.100Z",
    });
    prepare("dispatch-next", "message-next", "2026-08-14T10:00:03.100Z");
    expect(start("turn-old", "2026-08-14T10:00:03.100Z")).toBeUndefined();
    const oldRecords = projector.bindTurnContext({
      threadId: "thread-1",
      dispatchId: "dispatch-next",
      turnId: "turn-next",
    });
    expect(oldRecords[0]).toMatchObject({ messageId: "message-old" });
    expect(start("turn-next", "2026-08-14T10:00:03.100Z")).toMatchObject({
      messageId: "message-next",
    });

    prepare("dispatch-earlier", "message-earlier", "2026-08-14T10:00:04.000Z");
    projector.failTurnContext({
      threadId: "thread-1",
      dispatchId: "dispatch-earlier",
      failedAt: "2026-08-14T10:00:04.100Z",
    });
    prepare("dispatch-later", "message-later", "2026-08-14T10:00:04.100Z");
    expect(start("turn-later", "2026-08-14T10:00:04.100Z")).toBeUndefined();
    expect(start("turn-earlier", "2026-08-14T10:00:04.100Z")).toBeUndefined();
    const reverseRecords = projector.bindTurnContext({
      threadId: "thread-1",
      dispatchId: "dispatch-later",
      turnId: "turn-later",
    });
    expect(reverseRecords.filter((record) => record.type === "turn.context")).toMatchObject([
      { turnId: "turn-later", messageId: "message-later" },
      { turnId: "turn-earlier", messageId: "message-earlier" },
    ]);
  });

  it("keeps all turn records behind context when provider events beat returned turn ids", () => {
    const projector = createAgentQualityTraceProjector();
    projector.prepareTurnContext({
      dispatchId: "dispatch-fast",
      threadId: "thread-fast",
      messageId: "message-fast",
      messageText: "fast prompt",
      recordedAt: "2026-08-14T10:00:00.000Z",
      dispatchStartedAt: "2026-08-14T10:00:00.010Z",
    });
    const runtime = (value: Record<string, unknown>) =>
      projector.projectRuntimeEvent(runtimeEvent(value));

    expect(
      runtime({
        type: "turn.started",
        provider: "pi",
        createdAt: "2026-08-14T10:00:00.020Z",
        threadId: "thread-fast",
        turnId: "turn-fast",
        payload: { model: "fast-model" },
      }),
    ).toEqual([]);
    expect(
      runtime({
        type: "content.delta",
        provider: "pi",
        createdAt: "2026-08-14T10:00:00.030Z",
        threadId: "thread-fast",
        turnId: "turn-fast",
        payload: { streamKind: "assistant_text", delta: "private output" },
      }),
    ).toEqual([]);
    expect(
      runtime({
        type: "item.completed",
        provider: "pi",
        createdAt: "2026-08-14T10:00:00.040Z",
        threadId: "thread-fast",
        turnId: "turn-fast",
        itemId: "tool-fast",
        payload: {
          itemType: "mcp_tool_call",
          status: "completed",
          data: { toolName: "mcp__lattice__compile_project", input: { secret: "private" } },
        },
      }),
    ).toEqual([]);
    expect(
      projector.projectDomainEvent(
        domainEvent({
          type: "thread.turn-interrupt-requested",
          occurredAt: "2026-08-14T10:00:00.045Z",
          payload: { threadId: "thread-fast", turnId: "turn-fast" },
        }),
      ),
    ).toEqual([]);
    expect(
      runtime({
        type: "turn.completed",
        provider: "pi",
        createdAt: "2026-08-14T10:00:00.050Z",
        threadId: "thread-fast",
        turnId: "turn-fast",
        payload: { state: "completed", totalCostUsd: 0.001 },
      }),
    ).toEqual([]);
    expect(
      projector.projectDomainEvent(
        domainEvent({
          type: "thread.turn-interrupt-requested",
          occurredAt: "2026-08-14T10:00:00.055Z",
          payload: { threadId: "thread-fast" },
        }),
      ),
    ).toEqual([]);

    const records = projector.bindTurnContext({
      threadId: "thread-fast",
      dispatchId: "dispatch-fast",
      turnId: "turn-fast",
    });
    expect(records.map((record) => record.type)).toEqual([
      "turn.context",
      "turn.started",
      "turn.first-output",
      "tool",
      "stop",
      "turn.completed",
      "stop",
    ]);
    expect(records[0]).toMatchObject({ messageId: "message-fast" });
    expect(JSON.stringify(records)).not.toContain("private output");
    expect(JSON.stringify(records)).not.toContain('"secret":"private"');
  });

  it("flushes unresolved starts safely on session exit and correlation capacity limits", () => {
    const projector = createAgentQualityTraceProjector();
    const prepare = (dispatchId: string) =>
      projector.prepareTurnContext({
        dispatchId,
        threadId: "thread-capacity",
        messageId: dispatchId,
        messageText: `${dispatchId} prompt`,
        recordedAt: "2026-08-14T10:00:00.000Z",
        dispatchStartedAt: "2026-08-14T10:00:00.000Z",
      });
    const start = () =>
      projector.projectRuntimeEvent(
        runtimeEvent({
          type: "turn.started",
          provider: "claudeAgent",
          createdAt: "2026-08-14T10:00:00.100Z",
          threadId: "thread-capacity",
          turnId: "turn-unresolved",
          payload: {},
        }),
      );

    prepare("dispatch-0");
    expect(start()).toEqual([]);
    for (let index = 1; index < 64; index += 1) prepare(`dispatch-${index}`);
    const capacityRecords = prepare("dispatch-64");
    expect(capacityRecords.map((record) => record.type)).toEqual(["turn.context", "turn.started"]);
    expect(capacityRecords[0]).toMatchObject({ messageId: null, turnId: "turn-unresolved" });

    prepare("dispatch-exit");
    expect(start()).toEqual([]);
    const exitRecords = projector.projectRuntimeEvent(
      runtimeEvent({
        type: "session.exited",
        provider: "claudeAgent",
        createdAt: "2026-08-14T10:00:00.200Z",
        threadId: "thread-capacity",
        payload: { recoverable: true },
      }),
    );
    expect(exitRecords.map((record) => record.type)).toEqual([
      "turn.context",
      "turn.started",
      "session",
    ]);
    expect(exitRecords[0]).toMatchObject({ messageId: null });
    expect(
      projector.bindTurnContext({
        threadId: "thread-capacity",
        dispatchId: "dispatch-exit",
        turnId: "turn-unresolved",
      }),
    ).toEqual([]);
  });

  it("hashes matching literature identifiers without recording their values", () => {
    const projector = createAgentQualityTraceProjector();
    const tool = (
      itemId: string,
      toolName: string,
      input: Record<string, unknown>,
      data: Record<string, unknown> = {},
    ) =>
      projector.projectRuntimeEvent(
        runtimeEvent({
          type: "item.completed",
          provider: "codex",
          createdAt: "2026-08-14T10:00:00.000Z",
          threadId: "thread-1",
          turnId: "turn-1",
          itemId,
          payload: {
            itemType: "mcp_tool_call",
            status: "completed",
            data: { ...data, toolName: `mcp__lattice__${toolName}`, input },
          },
        }),
      )[0];
    const fetched = tool(
      "fetch",
      "fetch_paper",
      { arxivId: "2401.00001v2" },
      { result: { arxivId: "2401.00001v2", text: "private full text" } },
    );
    const read = tool(
      "read",
      "Read",
      {
        file_path: ".research/papers/2401.00001/paper.md",
      },
      { path: ".research/papers/2401.00001/paper.md", result: "private cached paper" },
    );
    const cited = tool("cite", "cite", { query: "https://arxiv.org/abs/2401.00001" });
    expect(fetched).toMatchObject({
      tool: {
        evidenceAccess: "fulltext",
        evidenceProvenance: "normalized-tool-completion",
        evidenceIds: [expect.stringMatching(/^[a-f0-9]{64}$/)],
      },
    });
    const fetchedEvidenceIds = (fetched?.tool as { evidenceIds?: unknown } | undefined)
      ?.evidenceIds;
    expect(read).toMatchObject({
      tool: {
        evidenceAccess: "fulltext",
        evidenceProvenance: "normalized-cached-paper-path",
        evidenceIds: fetchedEvidenceIds,
      },
    });
    expect(cited).toMatchObject({ tool: { evidenceIds: fetchedEvidenceIds } });
    expect(JSON.stringify([fetched, read, cited])).not.toContain("2401.00001");
    expect(JSON.stringify([fetched, read, cited])).not.toContain("private full text");
    expect(JSON.stringify([fetched, read, cited])).not.toContain("private cached paper");

    const inputOnly = tool("input-only", "fetch_paper", { arxivId: "2401.00002" });
    expect(inputOnly).not.toMatchObject({ tool: { evidenceAccess: "fulltext" } });

    const codexNested = projector.projectRuntimeEvent(
      runtimeEvent({
        type: "item.completed",
        provider: "codex",
        createdAt: "2026-08-14T10:00:00.100Z",
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "codex-fetch",
        payload: {
          itemType: "mcp_tool_call",
          status: "completed",
          data: {
            item: {
              type: "mcpToolCall",
              tool: "fetch_paper",
              arguments: { arxivId: "2401.00003" },
              result: { content: [{ type: "text", text: "private nested full text" }] },
            },
          },
        },
      }),
    )[0];
    expect(codexNested).toMatchObject({
      tool: {
        name: "fetch_paper",
        evidenceAccess: "fulltext",
        evidenceProvenance: "normalized-tool-completion",
      },
    });
    expect(JSON.stringify(codexNested)).not.toContain("2401.00003");
    expect(JSON.stringify(codexNested)).not.toContain("private nested full text");

    projector.projectRuntimeEvent(
      runtimeEvent({
        type: "item.started",
        provider: "openCode",
        createdAt: "2026-08-14T10:00:00.200Z",
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "opencode-fetch",
        payload: {
          itemType: "mcp_tool_call",
          status: "inProgress",
          data: {
            toolName: "fetch_paper",
            toolCallId: "opencode-fetch",
            input: { arxivId: "2401.00004" },
          },
        },
      }),
    );
    const openCodeCompleted = projector.projectRuntimeEvent(
      runtimeEvent({
        type: "item.completed",
        provider: "openCode",
        createdAt: "2026-08-14T10:00:00.300Z",
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "opencode-fetch",
        payload: {
          itemType: "dynamic_tool_call",
          status: "completed",
          data: {
            toolCallId: "opencode-fetch",
            structured: { content: "private OpenCode full text" },
          },
        },
      }),
    )[0];
    expect(openCodeCompleted).toMatchObject({
      tool: {
        name: "fetch_paper",
        evidenceAccess: "fulltext",
        evidenceProvenance: "normalized-tool-completion",
      },
    });
    expect(JSON.stringify(openCodeCompleted)).not.toContain("2401.00004");
    expect(JSON.stringify(openCodeCompleted)).not.toContain("private OpenCode full text");

    const openCodeMainLifecycle = projector.projectRuntimeEvent(
      runtimeEvent({
        type: "item.completed",
        provider: "openCode",
        createdAt: "2026-08-14T10:00:00.400Z",
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "opencode-main-fetch",
        payload: {
          itemType: "mcp_tool_call",
          status: "completed",
          data: {
            toolName: "fetch_paper",
            input: { arxivId: "2401.00005" },
            state: {
              status: "completed",
              output: "private OpenCode state output",
            },
          },
        },
      }),
    )[0];
    expect(openCodeMainLifecycle).toMatchObject({
      tool: {
        name: "fetch_paper",
        evidenceAccess: "fulltext",
        evidenceProvenance: "normalized-tool-completion",
      },
    });
    expect(JSON.stringify(openCodeMainLifecycle)).not.toContain("2401.00005");
    expect(JSON.stringify(openCodeMainLifecycle)).not.toContain("private OpenCode state output");
  });

  it("keeps stop, permission and recovery records correlated after the active turn settles", () => {
    const projector = createAgentQualityTraceProjector();
    const ids = { threadId: "thread-1", turnId: "turn-1" };
    projector.projectRuntimeEvent(
      runtimeEvent({
        type: "turn.started",
        provider: "claudeAgent",
        createdAt: "2026-08-14T10:00:00.000Z",
        ...ids,
        payload: {},
      }),
    );
    const records = [
      ...projector.projectRuntimeEvent(
        runtimeEvent({
          type: "request.opened",
          provider: "claudeAgent",
          createdAt: "2026-08-14T10:00:00.100Z",
          ...ids,
          requestId: "permission-1",
          payload: { requestType: "approval" },
        }),
      ),
      ...projector.projectDomainEvent(
        domainEvent({
          type: "thread.turn-interrupt-requested",
          occurredAt: "2026-08-14T10:00:00.200Z",
          payload: ids,
        }),
      ),
      ...projector.projectDomainEvent(
        domainEvent({
          type: "thread.checkpoint-revert-requested",
          occurredAt: "2026-08-14T10:00:00.300Z",
          payload: { threadId: ids.threadId, turnCount: 2 },
        }),
      ),
      ...projector.projectRuntimeEvent(
        runtimeEvent({
          type: "turn.completed",
          provider: "claudeAgent",
          createdAt: "2026-08-14T10:00:00.400Z",
          ...ids,
          payload: { state: "interrupted" },
        }),
      ),
      ...projector.projectRuntimeEvent(
        runtimeEvent({
          type: "request.resolved",
          provider: "claudeAgent",
          createdAt: "2026-08-14T10:00:00.500Z",
          threadId: ids.threadId,
          requestId: "permission-1",
          payload: { requestType: "approval", decision: "cancel" },
        }),
      ),
      ...projector.projectDomainEvent(
        domainEvent({
          type: "thread.reverted",
          occurredAt: "2026-08-14T10:00:00.600Z",
          payload: { threadId: ids.threadId, turnCount: 2 },
        }),
      ),
    ];

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "stop", turnId: ids.turnId, status: "requested" }),
        expect.objectContaining({
          type: "permission",
          turnId: ids.turnId,
          requestId: "permission-1",
          status: "requested",
        }),
        expect.objectContaining({
          type: "permission",
          turnId: ids.turnId,
          requestId: "permission-1",
          status: "resolved",
        }),
        expect.objectContaining({
          type: "session",
          turnId: ids.turnId,
          action: "recovery",
          checkpointTurnCount: 2,
        }),
        expect.objectContaining({
          type: "session",
          turnId: ids.turnId,
          action: "recovered",
          checkpointTurnCount: 2,
        }),
      ]),
    );
  });

  it("does not count a declined tool completion as successful", () => {
    const projector = createAgentQualityTraceProjector();
    const [record] = projector.projectRuntimeEvent(
      runtimeEvent({
        type: "item.completed",
        provider: "claudeAgent",
        createdAt: "2026-08-14T10:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        payload: {
          itemType: "mcp_tool_call",
          status: "declined",
          data: { toolName: "mcp__lattice__fetch_paper" },
        },
      }),
    );
    expect(record).toMatchObject({
      type: "tool",
      tool: { name: "fetch_paper", phase: "completed", status: "failed" },
    });
  });

  it("accepts only the strict content-free compile schema", () => {
    const result = {
      type: LATTICE_AGENT_COMPILE_RESULT,
      version: 1,
      threadId: "thread-1",
      turnId: "turn-1",
      checkpointRef: "refs/synara/checkpoints/1",
      compiledAt: "2026-08-14T10:00:01.000Z",
      success: true,
      durationMs: 100,
      rootDocument: "main.tex",
      diagnostics: { errors: 0, warnings: 1 },
    };
    expect(parseLatticeAgentCompileResult(result)).toEqual(result);
    expect(parseLatticeAgentCompileResult({ ...result, buildLog: "paper text" })).toBeNull();
    expect(
      parseLatticeAgentCompileResult({ ...result, rootDocument: "/private/main.tex" }),
    ).toBeNull();
    expect(
      parseLatticeAgentCompileResult({ ...result, rootDocument: "sections\\main.tex" }),
    ).toEqual({ ...result, rootDocument: "sections/main.tex" });
    expect(parseLatticeAgentCompileResult({ ...result, rootDocument: "file:main.tex" })).toBeNull();
    expect(
      parseLatticeAgentCompileResult({ ...result, threadId: "private manuscript text" }),
    ).toBeNull();
    expect(
      parseLatticeAgentCompileResult({ ...result, checkpointRef: "x".repeat(513) }),
    ).toBeNull();
    expect(
      parseLatticeAgentCompileResult({ ...result, compiledAt: "2026-02-30T10:00:01.000Z" }),
    ).toBeNull();
  });

  it("writes content-minimized NDJSON with private directory and file modes", () => {
    const directory = mkdtempSync(join(tmpdir(), "synara-quality-trace-"));
    temporaryDirectories.push(directory);
    const traceDirectory = join(directory, "trace");
    const write = createPrivateRotatingWriter(traceDirectory);
    write([
      {
        schemaVersion: 1,
        type: "turn.started",
        recordedAt: "2026-08-14T10:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
      },
    ]);
    const tracePath = join(traceDirectory, "agent-quality.ndjson");
    expect(statSync(traceDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(tracePath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(tracePath, "utf8"))).toMatchObject({
      type: "turn.started",
      threadId: "thread-1",
    });

    writeFileSync(tracePath, "x".repeat(10 * 1024 * 1024));
    writeFileSync(`${tracePath}.1`, "first");
    writeFileSync(`${tracePath}.2`, "second");
    writeFileSync(`${tracePath}.3`, "must-be-removed");
    write([
      {
        schemaVersion: 1,
        type: "rotation",
        recordedAt: "2026-08-14T10:00:01Z",
        threadId: "t",
        turnId: "u",
      },
    ]);
    expect(existsSync(tracePath)).toBe(true);
    expect(existsSync(`${tracePath}.1`)).toBe(true);
    expect(existsSync(`${tracePath}.2`)).toBe(true);
    expect(existsSync(`${tracePath}.3`)).toBe(false);
  });
});

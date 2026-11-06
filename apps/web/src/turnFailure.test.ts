import { EventId, MessageId, TurnId } from "@synara/contracts";
import { describe, expect, it } from "vitest";
import { setLanguagePreference } from "~/i18n";
import { applyOrchestrationEvents } from "./storeEventReducer";
import { normalizeThreadFromReadModel } from "./storeNormalization";
import {
  makeActivity,
  makeDomainEvent,
  makeReadModelThread,
  makeState,
  makeThread,
  threadsOf,
} from "./storeTestFixtures";
import { deriveTimelineEntries, deriveWorkLogEntries } from "./workLog";
import { deriveMessagesTimelineRows } from "./components/chat/MessagesTimeline.logic";

const turnId = TurnId.makeUnsafe("failed-turn");
const cause = "Selected model is at capacity. Please try a different model.";
const failure = makeActivity({
  id: "fatal-error",
  turnId,
  sequence: 2,
  kind: "runtime.error",
  tone: "error",
  summary: "Provider runtime error",
  payload: { message: cause, class: "provider_error" },
});
const completed = makeActivity({
  id: "failed-completion",
  turnId,
  sequence: 3,
  kind: "turn.completed",
  tone: "error",
  summary: "Turn failed",
  payload: { state: "failed", errorMessage: cause },
});

describe("durable turn failure feedback", () => {
  it("keeps one standalone failure after the session recovers to ready", () => {
    const initial = makeThread({
      activities: [failure, completed],
      error: cause,
      latestTurn: {
        turnId,
        state: "error",
        requestedAt: failure.createdAt,
        startedAt: failure.createdAt,
        completedAt: completed.createdAt,
        assistantMessageId: null,
      },
    });
    const state = applyOrchestrationEvents(makeState(initial), [
      makeDomainEvent("thread.session-set", {
        threadId: initial.id,
        session: {
          threadId: initial.id,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-10-05T08:11:00.000Z",
        },
      }),
    ]);
    const thread = threadsOf(state)[0]!;
    expect(thread.error).toBeNull();
    expect(thread.latestTurn?.state).toBe("error");
    const entries = deriveWorkLogEntries(thread.activities, turnId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ turnId, turnFailure: { cause } });
    const rows = deriveMessagesTimelineRows({
      timelineEntries: deriveTimelineEntries([], [], entries),
      isWorking: false,
      worktreeSetup: null,
      worktreeSetupOpen: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });
    expect(rows).toMatchObject([{ kind: "work", groupedEntries: [{ turnFailure: { cause } }] }]);
  });

  it("restores the cause on reopening even without a final assistant message", () => {
    const incoming = makeReadModelThread({
      activities: [failure, completed],
      session: {
        threadId: makeThread().id,
        status: "ready",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: "2026-10-05T08:11:00.000Z",
      },
    });
    const reopened = normalizeThreadFromReadModel(JSON.parse(JSON.stringify(incoming)), undefined);
    expect(reopened.messages).toEqual([]);
    expect(reopened.error).toBeNull();
    expect(deriveWorkLogEntries(reopened.activities, turnId)).toMatchObject([
      { turnFailure: { cause }, turnId },
    ]);
  });

  it("deduplicates replayed terminal events and keeps older failures after a new turn", () => {
    const nextTurn = TurnId.makeUnsafe("next-turn");
    const entries = deriveWorkLogEntries(
      [
        failure,
        completed,
        { ...failure, id: EventId.makeUnsafe("fatal-error-replay"), sequence: 4 },
        { ...completed, id: EventId.makeUnsafe("completion-replay"), sequence: 5 },
      ],
      nextTurn,
      {
        visibleTurnIds: new Set([nextTurn]),
      },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ turnId, turnFailure: { cause } });
  });

  it("shows an announced retry as active work and never as a failed task", () => {
    const warning = makeActivity({
      id: "retrying",
      turnId,
      kind: "runtime.warning",
      tone: "info",
      summary: "Runtime warning",
      payload: { message: cause, data: { willRetry: true } },
    });
    const entries = deriveWorkLogEntries([warning], turnId);
    expect(entries[0]?.label).toBe("Provider retrying");
    expect(entries.some((entry) => entry.turnFailure)).toBe(false);
    const success = {
      ...completed,
      id: EventId.makeUnsafe("success"),
      tone: "info" as const,
      payload: { state: "completed" },
      summary: "Turn completed",
    };
    expect(
      deriveWorkLogEntries([warning, success], turnId).some((entry) => entry.turnFailure),
    ).toBe(false);
  });

  it.each(["interrupted", "cancelled"])(
    "respects voluntary %s instead of reporting failure",
    (state) => {
      const terminal = {
        ...completed,
        tone: "info" as const,
        payload: { state },
        summary: "Turn interrupted",
      };
      expect(
        deriveWorkLogEntries([failure, terminal], turnId).some((entry) => entry.turnFailure),
      ).toBe(false);
    },
  );

  it("uses the overload code when the provider's wording changes", () => {
    const changed = {
      ...failure,
      payload: { message: "Temporarily unavailable", errorCode: "server_overloaded" },
    };
    expect(deriveWorkLogEntries([changed], turnId)[0]?.turnFailure?.message).toContain(
      "model is at capacity",
    );
  });

  it("keeps an idle connection error as runtime feedback without claiming task failure", () => {
    const idleError = { ...failure, turnId: null, payload: { message: "Connection lost" } };
    const entries = deriveWorkLogEntries([idleError], undefined);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.turnFailure).toBeUndefined();
  });

  it("does not duplicate a scoped completion with a subsequent unscoped runtime error", () => {
    const unscopedError = { ...failure, turnId: null, sequence: 4 };
    const failures = deriveWorkLogEntries([completed, unscopedError], turnId).filter(
      (entry) => entry.turnFailure,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.turnId).toBe(turnId);
  });

  it("does not turn an ambiguous completion into a per-turn task failure", () => {
    expect(
      deriveWorkLogEntries([{ ...completed, turnId: null }], turnId).some(
        (entry) => entry.turnFailure,
      ),
    ).toBe(false);
  });

  it("keeps a failed-turn notice outside folded progress messages after another turn starts", () => {
    const startedAt = "2026-10-05T08:00:00.000Z";
    const progressAt = "2026-10-05T08:05:00.000Z";
    const failedAt = "2026-10-05T08:10:40.000Z";
    const nextAt = "2026-10-05T08:12:00.000Z";
    const messages = [
      {
        id: MessageId.makeUnsafe("request"),
        role: "user" as const,
        text: "Review the PRs",
        createdAt: startedAt,
        streaming: false,
        turnId,
      },
      {
        id: MessageId.makeUnsafe("progress"),
        role: "assistant" as const,
        text: "Preparing worktrees",
        createdAt: progressAt,
        completedAt: progressAt,
        streaming: false,
        turnId,
      },
      {
        id: MessageId.makeUnsafe("next-request"),
        role: "user" as const,
        text: "Continue",
        createdAt: nextAt,
        streaming: false,
        turnId: TurnId.makeUnsafe("next-turn"),
      },
    ];
    const entries = deriveWorkLogEntries(
      [
        { ...failure, createdAt: failedAt },
        { ...completed, createdAt: failedAt },
      ],
      TurnId.makeUnsafe("next-turn"),
    );
    const rows = deriveMessagesTimelineRows({
      timelineEntries: deriveTimelineEntries(messages, [], entries),
      isWorking: true,
      activeTurnId: TurnId.makeUnsafe("next-turn"),
      collapseFinishedTurns: true,
      worktreeSetup: null,
      worktreeSetupOpen: false,
      activeTurnStartedAt: nextAt,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });
    expect(rows.filter((row) => row.kind === "work")).toMatchObject([
      { groupedEntries: [{ turnId, turnFailure: { cause } }] },
    ]);
  });
});

describe("Claude Code exit failures", () => {
  // What the Claude adapter emits when an outdated Claude Code rejects a launch
  // flag at startup: its stderr reason plus a next-step code.
  const exitTurnId = TurnId.makeUnsafe("claude-exit-turn");
  const reason =
    "Claude Code process exited with code 1: error: unknown option '--setting-sources=user,project,local'";
  const exitActivities = [
    makeActivity({
      id: "claude-exit-error",
      turnId: exitTurnId,
      sequence: 2,
      kind: "runtime.error",
      tone: "error",
      summary: "Provider runtime error",
      payload: { message: reason, class: "provider_error", errorCode: "claude_cli_outdated" },
    }),
    makeActivity({
      id: "claude-exit-completion",
      turnId: exitTurnId,
      sequence: 3,
      kind: "turn.completed",
      tone: "error",
      summary: "Turn failed",
      payload: { state: "failed", errorMessage: reason },
    }),
  ];

  it("shows Claude Code's reason and a localized next step on the card", () => {
    try {
      setLanguagePreference("zh-CN");
      const [zh] = deriveWorkLogEntries(exitActivities, exitTurnId);
      expect(zh?.turnFailure).toEqual({
        cause: reason,
        errorCode: "claude_cli_outdated",
        message: `任务因提供商错误而中断，工作尚未完成。${reason}`,
        nextStep:
          "你安装的 Claude Code 版本太旧，在这里运行不了。请在终端运行 `claude update`（或重装 Claude Code），然后重试。",
      });
      setLanguagePreference("en");
      const [en] = deriveWorkLogEntries(exitActivities, exitTurnId);
      expect(en?.turnFailure?.nextStep).toBe(
        "Your Claude Code is too old to run here. Run `claude update` in Terminal (or reinstall Claude Code), then try again.",
      );
    } finally {
      setLanguagePreference("en");
    }
  });

  it("tells the user to pick another model when the account cannot use this one", () => {
    const refusedTurnId = TurnId.makeUnsafe("claude-model-refused-turn");
    const cause = "The selected Claude model is unavailable for this account.";
    // Both events carry the Agent SDK's structured code, as the Claude adapter sends them.
    const activities = [
      makeActivity({
        id: "claude-model-refused-error",
        turnId: refusedTurnId,
        sequence: 2,
        kind: "runtime.error",
        tone: "error",
        summary: "Provider runtime error",
        payload: { message: cause, class: "provider_error", errorCode: "model_not_found" },
      }),
      makeActivity({
        id: "claude-model-refused-completion",
        turnId: refusedTurnId,
        sequence: 3,
        kind: "turn.completed",
        tone: "error",
        summary: "Turn failed",
        payload: { state: "failed", errorMessage: cause, errorCode: "model_not_found" },
      }),
    ];
    try {
      setLanguagePreference("zh-CN");
      expect(deriveWorkLogEntries(activities, refusedTurnId)[0]?.turnFailure?.nextStep).toBe(
        "你的 Claude 账号用不了这个模型。请点「更改模型」换一个。",
      );
      setLanguagePreference("en");
      expect(deriveWorkLogEntries(activities, refusedTurnId)[0]?.turnFailure?.nextStep).toBe(
        "Your Claude account can't use this model. Choose another one with Change model.",
      );
    } finally {
      setLanguagePreference("en");
    }
  });

  it("says what to try when Claude Code exited without a reason", () => {
    const generic = "Claude Code process exited with code 1";
    const failure = (errorCode?: string) =>
      deriveWorkLogEntries(
        [
          makeActivity({
            id: "claude-exit-generic",
            turnId: exitTurnId,
            sequence: 2,
            kind: "runtime.error",
            tone: "error",
            summary: "Provider runtime error",
            payload: {
              message: generic,
              class: "provider_error",
              ...(errorCode ? { errorCode } : {}),
            },
          }),
        ],
        exitTurnId,
      )[0]?.turnFailure;
    expect(failure("claude_cli_failed")).toMatchObject({
      message: `The task was interrupted by a provider error. Work remains incomplete. ${generic}`,
      nextStep:
        "Claude Code stopped unexpectedly. Run `claude -p hi` in Terminal to see why, fix it, then try again.",
    });
    // Errors without a code (other providers) keep the card as it was.
    expect(failure()?.nextStep).toBeUndefined();
  });
});

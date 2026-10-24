import { TurnId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { SYNARA_TURN_ACTIVITY, type SynaraTurnActivityMessage } from "../embedMode";
import {
  buildTurnActivityMessage,
  createTurnActivityReporter,
  relativizeToolPaths,
  TURN_ACTIVITY_MIN_INTERVAL_MS,
  type TurnActivitySnapshot,
  type TurnActivityWorkLogEntry,
} from "./latticeTurnActivity";

const ROOT = "/Users/me/paper";
const PROVIDER = { id: "claudeAgent", label: "Claude" };

function snapshot(overrides: Partial<TurnActivitySnapshot> = {}): TurnActivitySnapshot {
  return {
    workspaceRoot: ROOT,
    threadId: "thread-1",
    turnId: "turn-1",
    turnLive: true,
    awaitingInput: false,
    provider: PROVIDER,
    workLogEntries: [],
    ...overrides,
  };
}

function toolEntry(
  overrides: Partial<TurnActivityWorkLogEntry> & { running?: boolean } = {},
): TurnActivityWorkLogEntry {
  const { running = true, ...entry } = overrides;
  return {
    turnId: TurnId.makeUnsafe("turn-1"),
    tone: "tool",
    label: "Tool call",
    liveActivity: {
      state: running ? "running_tool" : "completed",
      label: "Tool call",
      lastActivityAt: "2026-10-24T00:00:00.000Z",
    },
    ...entry,
  };
}

describe("buildTurnActivityMessage", () => {
  it("reports a live turn with no tool in flight as running without a tool", () => {
    expect(buildTurnActivityMessage(snapshot())).toEqual({
      type: SYNARA_TURN_ACTIVITY,
      version: 1,
      workspaceRoot: ROOT,
      threadId: "thread-1",
      turnId: "turn-1",
      state: "running",
      provider: PROVIDER,
    });
  });

  it("names the tool in flight with its project-relative paths", () => {
    const message = buildTurnActivityMessage(
      snapshot({
        workLogEntries: [
          toolEntry({
            toolTitle: "Editing file",
            changedFiles: [`${ROOT}/slides/intro/index.tsx`, "slides/intro/notes.md"],
          }),
        ],
      }),
    );
    expect(message.state).toBe("running");
    expect(message.tool).toEqual({
      title: "Editing file",
      detail: null,
      paths: ["slides/intro/index.tsx", "slides/intro/notes.md"],
    });
  });

  it("drops the tool once it ends, and picks the newest of several", () => {
    const finished = toolEntry({ toolTitle: "Read", running: false, changedFiles: ["a.md"] });
    expect(buildTurnActivityMessage(snapshot({ workLogEntries: [finished] })).tool).toBeUndefined();

    const message = buildTurnActivityMessage(
      snapshot({
        workLogEntries: [
          toolEntry({ toolTitle: "Older" }),
          toolEntry({ toolTitle: "Newer" }),
          finished,
        ],
      }),
    );
    expect(message.tool?.title).toBe("Newer");
  });

  it("ignores tools from earlier turns and non-tool rows", () => {
    const message = buildTurnActivityMessage(
      snapshot({
        workLogEntries: [
          toolEntry({ turnId: TurnId.makeUnsafe("turn-0") }),
          toolEntry({ tone: "thinking" }),
        ],
      }),
    );
    expect(message.tool).toBeUndefined();
  });

  it("keeps only a one-line read target or command as detail, never output", () => {
    const command = buildTurnActivityMessage(
      snapshot({
        workLogEntries: [
          toolEntry({
            toolTitle: "Running command",
            command: "cat > slides/a/index.tsx <<'EOF'\nexport default secret contents\nEOF",
          }),
        ],
      }),
    );
    expect(command.tool?.detail).toBe("cat > slides/a/index.tsx <<'EOF'");

    const preview = buildTurnActivityMessage(
      snapshot({ workLogEntries: [toolEntry({ toolTitle: "Reading", preview: "notes.md" })] }),
    );
    expect(preview.tool?.detail).toBe("notes.md");

    const long = buildTurnActivityMessage(
      snapshot({ workLogEntries: [toolEntry({ command: "x".repeat(400) })] }),
    );
    expect(long.tool?.detail).toHaveLength(160);
    expect(long.tool?.detail?.endsWith("…")).toBe(true);
  });

  it("waits on a pending approval or question while the turn is live", () => {
    const message = buildTurnActivityMessage(
      snapshot({ awaitingInput: true, workLogEntries: [toolEntry({ toolTitle: "Write" })] }),
    );
    expect(message.state).toBe("waiting");
    expect(message.tool?.title).toBe("Write");
  });

  it("is idle with no tool once the turn has settled, however it ended", () => {
    const message = buildTurnActivityMessage(
      snapshot({ turnLive: false, awaitingInput: true, workLogEntries: [toolEntry()] }),
    );
    expect(message.state).toBe("idle");
    expect(message.turnId).toBe("turn-1");
    expect(message).not.toHaveProperty("tool");
  });
});

describe("relativizeToolPaths", () => {
  it("relativizes paths inside the workspace and drops those outside it", () => {
    expect(
      relativizeToolPaths(
        [
          `${ROOT}/slides/a/index.tsx`,
          "/Users/me/other/file.ts",
          `${ROOT}`,
          "./slides/a/notes.md",
          "../escape.md",
          "slides/../../escape.md",
          `${ROOT}/slides/a/index.tsx`,
        ],
        ROOT,
      ),
    ).toEqual(["slides/a/index.tsx", "slides/a/notes.md"]);
  });

  it("handles Windows separators and drive letters case-insensitively", () => {
    expect(
      relativizeToolPaths(
        [
          "c:\\Users\\Me\\Paper\\slides\\a\\index.tsx",
          "slides\\b\\index.tsx",
          "D:\\elsewhere\\x.ts",
        ],
        "C:\\Users\\me\\paper",
      ),
    ).toEqual(["slides/a/index.tsx", "slides/b/index.tsx"]);
  });

  it("returns an empty list when nothing is known", () => {
    expect(relativizeToolPaths([], ROOT)).toEqual([]);
  });
});

function fakeClock() {
  let time = 0;
  const timers: Array<{ at: number; callback: () => void; handle: number }> = [];
  let nextHandle = 1;
  return {
    now: () => time,
    setTimer: (callback: () => void, delayMs: number) => {
      const handle = nextHandle++;
      timers.push({ at: time + delayMs, callback, handle });
      return handle;
    },
    clearTimer: (handle: unknown) => {
      const index = timers.findIndex((timer) => timer.handle === handle);
      if (index >= 0) timers.splice(index, 1);
    },
    advance(ms: number) {
      const end = time + ms;
      for (;;) {
        timers.sort((left, right) => left.at - right.at);
        const due = timers[0];
        if (!due || due.at > end) break;
        timers.shift();
        time = due.at;
        due.callback();
      }
      time = end;
    },
  };
}

function reporterHarness() {
  const clock = fakeClock();
  const sent: Array<{ at: number; message: SynaraTurnActivityMessage }> = [];
  const reporter = createTurnActivityReporter({
    post: (message) => sent.push({ at: clock.now(), message }),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, sent, reporter };
}

const running = (overrides: Partial<TurnActivitySnapshot> = {}) =>
  buildTurnActivityMessage(snapshot(overrides));
const idle = (overrides: Partial<TurnActivitySnapshot> = {}) =>
  buildTurnActivityMessage(snapshot({ turnLive: false, ...overrides }));

describe("createTurnActivityReporter", () => {
  it("sends the first change at once and does not repeat an unchanged state", () => {
    const { sent, reporter } = reporterHarness();
    reporter.report(running());
    reporter.report(running());
    expect(sent.map((entry) => entry.message.state)).toEqual(["running"]);
  });

  it("re-sends the current state when forced, as after a remount or embed-ready", () => {
    const { clock, sent, reporter } = reporterHarness();
    reporter.report(idle());
    clock.advance(1_000);
    reporter.report(idle(), { force: true });
    clock.advance(1_000);
    expect(sent.map((entry) => entry.message.state)).toEqual(["idle", "idle"]);
  });

  it("follows a tool from start to end through to the final idle", () => {
    const { clock, sent, reporter } = reporterHarness();
    const edit = { toolTitle: "Edit", changedFiles: [`${ROOT}/slides/a/index.tsx`] };
    reporter.report(running());
    clock.advance(300);
    reporter.report(running({ workLogEntries: [toolEntry(edit)] }));
    clock.advance(300);
    reporter.report(running({ workLogEntries: [toolEntry({ ...edit, running: false })] }));
    clock.advance(300);
    reporter.report(idle());
    clock.advance(300);
    expect(
      sent.map(({ message }) => [message.state, message.tool?.paths ?? null] as const),
    ).toEqual([
      ["running", null],
      ["running", ["slides/a/index.tsx"]],
      ["running", null],
      ["idle", null],
    ]);
  });

  it("stays at four a second and always delivers the latest state last", () => {
    const { clock, sent, reporter } = reporterHarness();
    for (let index = 0; index < 100; index += 1) {
      reporter.report(running({ workLogEntries: [toolEntry({ toolTitle: `Tool ${index}` })] }));
      clock.advance(10);
    }
    reporter.report(idle());
    clock.advance(1_000);

    for (let index = 1; index < sent.length; index += 1) {
      expect(sent[index]!.at - sent[index - 1]!.at).toBeGreaterThanOrEqual(
        TURN_ACTIVITY_MIN_INTERVAL_MS,
      );
    }
    expect(sent.length).toBeLessThanOrEqual(6);
    expect(sent.at(-1)?.message.state).toBe("idle");
    expect(sent.at(-1)?.message).not.toHaveProperty("tool");
  });

  it("delivers a final idle that lands inside the throttle window on the trailing edge", () => {
    const { clock, sent, reporter } = reporterHarness();
    reporter.report(running());
    clock.advance(50);
    reporter.report(idle());
    expect(sent).toHaveLength(1);
    clock.advance(TURN_ACTIVITY_MIN_INTERVAL_MS);
    expect(sent.map(({ at, message }) => [at, message.state])).toEqual([
      [0, "running"],
      [TURN_ACTIVITY_MIN_INTERVAL_MS, "idle"],
    ]);
  });

  it("idles a running thread the panel switches away from before the new one", () => {
    const { clock, sent, reporter } = reporterHarness();
    reporter.report(running({ workLogEntries: [toolEntry({ toolTitle: "Edit" })] }));
    reporter.report(idle({ threadId: "thread-2", turnId: null }));
    clock.advance(1_000);
    expect(sent.map(({ message }) => [message.threadId, message.state, message.tool])).toEqual([
      ["thread-1", "running", { title: "Edit", detail: null, paths: [] }],
      ["thread-1", "idle", undefined],
      ["thread-2", "idle", undefined],
    ]);
  });

  it("idles the thread a closing view still held, and leaves a taken-over one alone", () => {
    const { clock, sent, reporter } = reporterHarness();
    reporter.report(running());
    reporter.release("thread-1");
    clock.advance(1_000);
    expect(sent.map(({ message }) => message.state)).toEqual(["running", "idle"]);

    reporter.report(running({ threadId: "thread-2" }));
    clock.advance(1_000);
    reporter.release("thread-1");
    clock.advance(1_000);
    expect(sent.map(({ message }) => [message.threadId, message.state])).toEqual([
      ["thread-1", "running"],
      ["thread-1", "idle"],
      ["thread-2", "running"],
    ]);
  });

  it("sends nothing after dispose", () => {
    const { clock, sent, reporter } = reporterHarness();
    reporter.report(running());
    reporter.report(idle());
    reporter.dispose();
    clock.advance(1_000);
    expect(sent).toHaveLength(1);
  });
});

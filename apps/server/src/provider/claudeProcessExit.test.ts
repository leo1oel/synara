import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  captureClaudeStderr,
  classifyClaudeFailure,
  claudeStderrReason,
  describeClaudeProcessExit,
} from "./claudeProcessExit.ts";

const EXIT_1 = "Claude Code process exited with code 1";

// Stderr each real Claude Code printed when it exited 1 before any output, as
// reproduced against the pinned SDK's launch arguments.
describe("describeClaudeProcessExit", () => {
  it.each([
    [
      "1.0.100 rejecting --setting-sources",
      "error: unknown option '--setting-sources=user,project,local'\n",
      "error: unknown option '--setting-sources=user,project,local'",
      "claude_cli_outdated",
    ],
    [
      "2.0.0 rejecting the Full access flag",
      "error: unknown option '--allow-dangerously-skip-permissions'\n",
      "error: unknown option '--allow-dangerously-skip-permissions'",
      "claude_cli_outdated",
    ],
    [
      "npm Claude Code on an old Node",
      "Error: Claude Code requires Node.js version 18 or higher.\n",
      "Error: Claude Code requires Node.js version 18 or higher.",
      "claude_cli_failed",
    ],
    [
      "a corrupted ~/.claude.json",
      [
        "Claude configuration file at /Users/someone/.claude.json is corrupted: JSON Parse error: Expected '}'",
        "The corrupted file has been backed up to: /Users/someone/.claude/backups/.claude.json.corrupted.1",
        "",
      ].join("\n"),
      "Claude configuration file at ~/…/.claude.json is corrupted: JSON Parse error: Expected '}'",
      "claude_cli_failed",
    ],
  ])("explains %s", (_label, stderr, reason, errorCode) => {
    expect(
      describeClaudeProcessExit({ message: EXIT_1, stderr, homeDir: "/Users/someone" }),
    ).toEqual({ message: `${EXIT_1}: ${reason}`, errorCode });
  });

  it("keeps the generic message without stderr, and leaves other failures alone", () => {
    expect(describeClaudeProcessExit({ message: EXIT_1, stderr: "" })).toEqual({
      message: EXIT_1,
      errorCode: "claude_cli_failed",
    });
    expect(describeClaudeProcessExit({ message: EXIT_1, stderr: undefined })).toEqual({
      message: EXIT_1,
      errorCode: "claude_cli_failed",
    });
    expect(
      describeClaudeProcessExit({ message: "Claude runtime stream failed.", stderr: "boom" }),
    ).toEqual({ message: "Claude runtime stream failed." });
  });

  it("uses the SDK's own stderr suffix when it owned the spawn", () => {
    expect(
      describeClaudeProcessExit({
        message: `${EXIT_1}. stderr: error: unknown option '--no-session-persistence'`,
        stderr: undefined,
      }),
    ).toEqual({
      message: `${EXIT_1}: error: unknown option '--no-session-persistence'`,
      errorCode: "claude_cli_outdated",
    });
  });
});

describe("claudeStderrReason", () => {
  it("skips Node warnings and stack frames and redacts secrets", () => {
    expect(
      claudeStderrReason(
        [
          "(node:12) ExperimentalWarning: SQLite is an experimental feature",
          "\u001b[31mError: Invalid API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789\u001b[0m",
          "    at main (file:///opt/claude/cli.js:1:1)",
        ].join("\n"),
      ),
    ).toBe("Error: Invalid API key [redacted]");
  });
});

describe("classifyClaudeFailure", () => {
  it.each([
    ["Not logged in · Please run /login", "claude_auth_required"],
    ["Invalid API key · Please run /login", "claude_auth_required"],
    [
      "There's an issue with the selected model (claude-fable-5-1). It may not exist or you may not have access to it.",
      "claude_model_unavailable",
    ],
    ["error: unknown option '--effort'", "claude_cli_outdated"],
    // A refused account or network, as Claude Code 2.1.296 prints it (API key) and as
    // the affected user's `claude -p hi` printed it (OAuth): not a sign-in problem.
    ["Failed to authenticate. API Error: 403 Request not allowed", "claude_access_forbidden"],
    [
      'Failed to authenticate. API Error: 403 {"error":{"type":"forbidden","message":"Request not allowed"}}',
      "claude_access_forbidden",
    ],
    ["Failed to authenticate. API Error: 401 Invalid bearer token", undefined],
    ["Error: Session ID 1 is already in use.", undefined],
  ])("classifies %j", (text, code) => {
    expect(classifyClaudeFailure(text)).toBe(code);
  });
});

describe("captureClaudeStderr", () => {
  it("forwards every chunk and settles once stderr closes", async () => {
    const stream = new PassThrough();
    const forwarded: Array<string> = [];
    const capture = captureClaudeStderr(stream, (chunk) => forwarded.push(String(chunk)));
    stream.write("error: unknown ");
    stream.end("option '--x'\n");
    await capture?.settled();
    expect(forwarded.join("")).toBe("error: unknown option '--x'\n");
    expect(capture?.text()).toBe("error: unknown option '--x'\n");
  });

  it("does nothing for a process without a stderr stream", () => {
    expect(captureClaudeStderr(undefined, () => undefined)).toBeUndefined();
  });
});

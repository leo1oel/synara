// A Claude Code that dies at startup (here: an outdated CLI rejecting one of the
// SDK's launch flags) explains itself only on stderr. These tests run the real
// Agent SDK and Synara's own spawn against a stand-in `claude` and check that the
// failed turn carries that reason and a next-step code, not just "exited with code 1".
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId, type ProviderRuntimeEvent } from "@synara/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Stream } from "effect";
import { afterEach } from "vitest";

import { ServerConfig } from "../../config.ts";
import { MINIMUM_CLAUDE_AUTO_MODE_CLI_VERSION } from "../claudeCliVersion.ts";
import { ClaudeAdapter } from "../Services/ClaudeAdapter.ts";
import { makeClaudeAdapterLive } from "./ClaudeAdapter.ts";

const THREAD_ID = ThreadId.makeUnsafe("thread-claude-exit-1");
const tempDirs: Array<string> = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Stands in for `claude`: writes `stderr` and exits 1 before reading any input,
// exactly like Claude Code 1.0.x given the pinned SDK's arguments.
function standInClaude(stderr: string): { readonly binaryPath: string; readonly dir: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "claude-exit-1-"));
  tempDirs.push(dir);
  const binaryPath = path.join(dir, "claude");
  const lines = stderr
    .split("\n")
    .map((line) => `printf '%s\\n' '${line.replaceAll("'", "'\\''")}' >&2`)
    .join("\n");
  writeFileSync(binaryPath, `#!/bin/sh\n${lines}\nexit 1\n`);
  chmodSync(binaryPath, 0o755);
  return { binaryPath, dir };
}

function runFailedTurn(binaryPath: string, dir: string) {
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter;
    const events = yield* adapter.streamEvents.pipe(
      Stream.takeUntil((event) => event.type === "turn.completed"),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: "claudeAgent",
      runtimeMode: "full-access",
      cwd: dir,
      providerOptions: { claudeAgent: { binaryPath } },
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-fable-5-1",
        options: { effort: "high" },
      },
    });
    yield* adapter.sendTurn({ threadId: THREAD_ID, input: "hi", attachments: [] });
    const collected: Array<ProviderRuntimeEvent> = Array.from(
      yield* Fiber.join(events).pipe(Effect.timeout("20 seconds")),
    );
    const runtimeError = collected.find((event) => event.type === "runtime.error");
    const turnCompleted = collected.find((event) => event.type === "turn.completed");
    return { runtimeError, turnCompleted };
  }).pipe(
    Effect.provide(
      makeClaudeAdapterLive({
        readClaudeCliVersion: async () => MINIMUM_CLAUDE_AUTO_MODE_CLI_VERSION,
      }).pipe(
        Layer.provideMerge(ServerConfig.layerTest(dir, dir)),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );
}

describe("Claude Code exiting at startup", () => {
  it.live("puts an outdated CLI's stderr reason and an update step on the failed turn", () => {
    const { binaryPath, dir } = standInClaude(
      "error: unknown option '--setting-sources=user,project,local'",
    );
    return Effect.gen(function* () {
      const { runtimeError, turnCompleted } = yield* runFailedTurn(binaryPath, dir);
      const expected =
        "Claude Code process exited with code 1: error: unknown option '--setting-sources=user,project,local'";

      assert.equal(runtimeError?.type, "runtime.error");
      if (runtimeError?.type === "runtime.error") {
        assert.equal(runtimeError.payload.message, expected);
        assert.equal(runtimeError.payload.errorCode, "claude_cli_outdated");
      }
      assert.equal(turnCompleted?.type, "turn.completed");
      if (turnCompleted?.type === "turn.completed") {
        assert.equal(turnCompleted.payload.state, "failed");
        assert.equal(turnCompleted.payload.errorMessage, expected);
      }
    });
  });

  it.live("redacts secrets and keeps one meaningful line from a noisy stderr", () => {
    const { binaryPath, dir } = standInClaude(
      [
        "(node:4242) ExperimentalWarning: something unrelated",
        "Error: Invalid API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 · Please run /login",
        "    at main (file:///opt/claude/cli.js:1:1)",
      ].join("\n"),
    );
    return Effect.gen(function* () {
      const { runtimeError } = yield* runFailedTurn(binaryPath, dir);
      assert.equal(runtimeError?.type, "runtime.error");
      if (runtimeError?.type === "runtime.error") {
        const message = runtimeError.payload.message;
        assert.match(message, /^Claude Code process exited with code 1: Error: Invalid API key/);
        assert.notMatch(message, /sk-ant-api03/);
        assert.notMatch(message, /\n|ExperimentalWarning|cli\.js/);
        assert.equal(runtimeError.payload.errorCode, "claude_auth_required");
      }
    });
  });

  it.live("keeps the generic message when Claude Code wrote nothing to stderr", () => {
    const { binaryPath, dir } = standInClaude("");
    return Effect.gen(function* () {
      const { runtimeError } = yield* runFailedTurn(binaryPath, dir);
      assert.equal(runtimeError?.type, "runtime.error");
      if (runtimeError?.type === "runtime.error") {
        assert.equal(runtimeError.payload.message, "Claude Code process exited with code 1");
        assert.equal(runtimeError.payload.errorCode, undefined);
      }
    });
  });
});

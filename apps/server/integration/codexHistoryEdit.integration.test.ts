import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ThreadId } from "@synara/contracts";
import { expect, it, vi } from "vitest";

import { CodexAppServerManager } from "../src/codexAppServerManager";

// Use the real process/stdio/session boundary with a deterministic Codex peer.
// Paginated history rejects rollback even for short conversations.
it.skipIf(process.platform === "win32")(
  "edits a resumed paginated conversation and sends the replacement without stale history",
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "codex-history-edit-"));
    const homePath = path.join(dir, "codex-home");
    mkdirSync(homePath);
    vi.stubEnv("SYNARA_HOME", path.join(dir, "synara"));
    const binaryPath = path.join(dir, "codex");
    writeFileSync(
      binaryPath,
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(dir, "codex.cjs"))} "$@"\n`,
      { mode: 0o755 },
    );
    writeFileSync(
      path.join(dir, "codex.cjs"),
      `
if (process.argv.includes("--version")) {
  console.log("codex-cli 0.153.4");
  process.exit(0);
}
let turns = ["keep", "edit", "discard"].map(id => ({ id, items: [] }));
const thread = () => ({ id: "native-thread", historyMode: "paginated", turns: [] });
require("node:readline").createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const { method, params } = request;
  let result = {};
  let error;
  if (method === "thread/start" || method === "thread/resume") result = { thread: thread() };
  if (method === "thread/read") result = { thread: { ...thread(), turns: params.includeTurns ? turns : [] } };
  if (method === "thread/rollback") error = { code: -32600, message: "paginated threads do not support thread/rollback" };
  if (method === "thread/turns/list") {
    const ordered = params.sortDirection === "asc" ? turns : [...turns].reverse();
    const offset = Number(params.cursor ?? 0);
    result = { data: ordered.slice(offset, offset + 1), nextCursor: offset + 1 < ordered.length ? String(offset + 1) : null };
  }
  if (method === "thread/revert") {
    const index = turns.findIndex(turn => turn.id === params.beforeTurnId);
    if (index < 0) error = { code: -32600, message: "unknown turn" };
    else { turns = turns.slice(0, index); result = { thread: thread() }; }
  }
  if (method === "turn/start") {
    const turn = { id: "replacement", items: [] };
    turns.push(turn);
    result = { turn };
  }
  console.log(JSON.stringify({ id: request.id, ...(error ? { error } : { result }) }));
});
`,
    );
    const manager = new CodexAppServerManager();
    const threadId = ThreadId.makeUnsafe("history-edit");
    try {
      await manager.startSession({
        threadId,
        cwd: dir,
        runtimeMode: "full-access",
        resumeCursor: { threadId: "native-thread" },
        providerOptions: { codex: { binaryPath, homePath } },
      });
      const retained = await manager.rollbackThread(threadId, 2);
      expect(retained.turns.map((turn) => turn.id)).toEqual(["keep"]);
      expect((await manager.sendTurn({ threadId, input: "edited message" })).turnId).toBe(
        "replacement",
      );
      expect((await manager.readThread(threadId)).turns.map((turn) => turn.id)).toEqual([
        "keep",
        "replacement",
      ]);
    } finally {
      await manager.stopAll();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  20_000,
);

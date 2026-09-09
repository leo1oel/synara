import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ThreadId } from "@synara/contracts";
import { expect, it, vi } from "vitest";

import { CodexAppServerManager } from "../src/codexAppServerManager";
import { teardownProviderProcessTree } from "../src/platform/supervisedProcessTeardown";

// Exercise the real CLI, stdio transport, replacement barrier and resume path.
// Only provider responses and the observed failed OS snapshot are controlled;
// no user's installed CLI, credentials or project files are touched.
it.skipIf(process.platform === "win32")(
  "resumes the same thread on the updated CLI after a failed teardown snapshot",
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "codex-update-recovery-"));
    const homePath = path.join(dir, "codex-home");
    mkdirSync(homePath);
    vi.stubEnv("SYNARA_HOME", path.join(dir, "synara"));
    vi.stubEnv("PATH", `${dir}${path.delimiter}${process.env.PATH ?? ""}`);
    const failedScanMarker = path.join(dir, "fail-process-scan");
    writeFileSync(
      path.join(dir, "ps"),
      `#!/bin/sh\nif [ -f ${JSON.stringify(failedScanMarker)} ]; then echo 'process snapshot temporarily unavailable' >&2; exit 1; fi\nexec /bin/ps "$@"\n`,
      { mode: 0o755 },
    );
    const binaryPath = path.join(dir, "codex");
    const install = (version: number) => {
      writeFileSync(
        binaryPath,
        `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(dir, `codex-${version}.cjs`))} "$@"\n`,
        { mode: 0o755 },
      );
      writeFileSync(
        path.join(dir, `codex-${version}.cjs`),
        `
if (process.argv.includes("--version")) {
  console.log("codex-cli 9.9.${version}");
  process.exit(0);
}
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result = {};
  if (request.method === "thread/start" || request.method === "thread/resume") {
    result = { thread: { id: request.params.threadId ?? "persisted-codex-thread" } };
  }
  if (request.method === "turn/start") result = { turn: { id: "turn-v${version}" } };
  console.log(JSON.stringify({ id: request.id, result }));
});
`,
      );
    };
    let rootPid: number | undefined;
    const manager = new CodexAppServerManager(undefined, {
      teardownProcessTree: (input) => {
        rootPid = input.rootPid;
        return teardownProviderProcessTree(input);
      },
    });
    const threadId = ThreadId.makeUnsafe("update-recovery");
    const input = {
      threadId,
      cwd: dir,
      runtimeMode: "full-access" as const,
      providerOptions: { codex: { binaryPath, homePath } },
    };
    try {
      install(1);
      const original = await manager.startSession(input);
      expect((await manager.sendTurn({ threadId, input: "before update" })).turnId).toBe("turn-v1");

      install(2);
      writeFileSync(failedScanMarker, "");
      await expect(
        manager.startSession({ ...input, resumeCursor: original.resumeCursor }),
      ).rejects.toThrow("Failed to prove Codex app-server process-tree exit");
      expect(manager.hasSession(threadId)).toBe(false);
      // Keep ancestry observable rather than killing the root after a failed
      // snapshot and stranding its descendants before the user's retry.
      expect(rootPid).toBeTypeOf("number");
      expect(() => process.kill(rootPid!, 0)).not.toThrow();

      rmSync(failedScanMarker);
      const resumed = await manager.startSession({ ...input, resumeCursor: original.resumeCursor });
      expect(resumed.resumeCursor).toEqual(original.resumeCursor);
      expect((await manager.sendTurn({ threadId, input: "after update" })).turnId).toBe("turn-v2");
    } finally {
      rmSync(failedScanMarker, { force: true });
      try {
        await manager.stopAll();
      } finally {
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  20_000,
);

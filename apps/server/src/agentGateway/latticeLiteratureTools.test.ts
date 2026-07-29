import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeLatticeLiteratureTools } from "./latticeLiteratureTools.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Lattice literature tools", () => {
  it("delegates citation mutations to the Lattice executable for the active workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lattice-literature-"));
    temporaryRoots.push(workspaceRoot);
    const executable = path.join(workspaceRoot, "lattice-stub.mjs");
    await writeFile(
      executable,
      [
        "#!/usr/bin/env node",
        "const request = JSON.parse(process.argv[3]);",
        "if (process.argv[2] !== 'literature') process.exit(2);",
        "process.stdout.write(JSON.stringify({",
        "  citationKey: 'vaswani2017attention',",
        "  title: 'Attention Is All You Need',",
        "  paperPath: process.env.LATTICE_PROJECT_ROOT + '/papers/attention.md',",
        "  request,",
        "}));",
      ].join("\n"),
    );
    await chmod(executable, 0o755);
    vi.stubEnv("LATTICE_BIN", executable);

    const tools = makeLatticeLiteratureTools({
      resolveWorkspaceRoot: () => Effect.succeed(workspaceRoot),
    });
    const cite = tools.find((tool) => tool.definition.name === "cite");
    expect(cite).toBeDefined();
    const result = await Effect.runPromise(
      cite!.handler(
        { query: "Attention Is All You Need" },
        {
          principal: {
            kind: "provider-session",
            sessionKey: "session",
            threadId: "thread",
            provider: "codex",
            turnId: "turn",
          },
          callerThreadId: "thread",
          callerSessionKey: "session",
          callerProvider: "codex",
          callerCapabilities: new Set(["literature:write"]),
          callerTurnId: "turn",
          assertCallerTurnActive: () => Effect.void,
          jsonRpcRequestId: "request",
        },
      ),
    );

    expect(result.isError).not.toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("\\cite{vaswani2017attention}"),
    });
    expect(JSON.stringify(result)).toContain(`${workspaceRoot}/papers/attention.md`);
  });
});

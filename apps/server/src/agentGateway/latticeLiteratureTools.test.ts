import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeLatticeLiteratureTools } from "./latticeLiteratureTools.ts";
import type { ToolContext } from "./toolRuntime.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Lattice literature tools", () => {
  it("delegates citation mutations to the unsandboxed Lattice host broker", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lattice-literature-"));
    temporaryRoots.push(workspaceRoot);
    const mutateBibliography = vi.fn(() =>
      Effect.succeed({
        citationKey: "vaswani2017attention",
        title: "Attention Is All You Need",
        paperPath: `${workspaceRoot}/papers/attention.md`,
      }),
    );

    const tools = makeLatticeLiteratureTools({
      resolveWorkspaceRoot: () => Effect.succeed(workspaceRoot),
      mutateBibliography,
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
    expect(mutateBibliography).toHaveBeenCalledWith(workspaceRoot, "cite", {
      query: "Attention Is All You Need",
    });
    const upgrade = tools.find((tool) => tool.definition.name === "upgrade_bibliography");
    const remove = tools.find((tool) => tool.definition.name === "remove_reference");
    expect(upgrade).toBeDefined();
    expect(remove).toBeDefined();
    const mutationContext: ToolContext = {
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
    };
    await Effect.runPromise(upgrade!.handler({ dryRun: true }, mutationContext));
    await Effect.runPromise(remove!.handler({ key: "incorrect2024" }, mutationContext));
    expect(mutateBibliography).toHaveBeenCalledWith(workspaceRoot, "upgrade_bibliography", {
      dryRun: true,
    });
    expect(mutateBibliography).toHaveBeenCalledWith(workspaceRoot, "remove_reference", {
      key: "incorrect2024",
    });
  });

  it("lists and searches the paper library through the executable dispatch", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lattice-literature-"));
    temporaryRoots.push(workspaceRoot);
    const executable = path.join(workspaceRoot, "lattice-stub.mjs");
    await writeFile(
      executable,
      [
        "#!/usr/bin/env node",
        "const request = JSON.parse(process.argv[3]);",
        "if (process.argv[2] !== 'literature') process.exit(2);",
        "process.stdout.write(JSON.stringify(request.tool === 'list_papers'",
        "  ? { papers: [{ title: 'Attention Is All You Need', citationKey: 'vaswani2017attention', arxivId: '1706.03762', fullTextPath: '.research/papers/1706.03762/paper.md' }] }",
        "  : { results: [{ kind: 'paper', path: '.research/papers/1706.03762/paper.md', line: 3, snippet: 'scaled dot-product attention' }], request }));",
      ].join("\n"),
    );
    await chmod(executable, 0o755);
    vi.stubEnv("LATTICE_BIN", executable);

    const context: ToolContext = {
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
      callerCapabilities: new Set(["literature:read"]),
      callerTurnId: "turn",
      assertCallerTurnActive: () => Effect.void,
      jsonRpcRequestId: "request",
    };
    const tools = makeLatticeLiteratureTools({
      resolveWorkspaceRoot: () => Effect.succeed(workspaceRoot),
      mutateBibliography: () => Effect.die("unexpected bibliography mutation"),
    });

    const listPapers = tools.find((tool) => tool.definition.name === "list_papers");
    expect(listPapers).toBeDefined();
    const listed = await Effect.runPromise(listPapers!.handler({}, context));
    expect(listed.isError).not.toBe(true);
    expect(JSON.stringify(listed)).toContain(".research/papers/1706.03762/paper.md");
    expect(JSON.stringify(listed)).toContain("vaswani2017attention");

    const searchLibrary = tools.find((tool) => tool.definition.name === "search_library");
    expect(searchLibrary).toBeDefined();
    const found = await Effect.runPromise(
      searchLibrary!.handler({ query: "scaled dot-product" }, context),
    );
    expect(found.isError).not.toBe(true);
    const payload = JSON.stringify(found);
    // The stub echoes the dispatched request: tool tag and query arrived intact.
    expect(payload).toContain("search_library");
    expect(payload).toContain("scaled dot-product");
  });

  it("captures webpages through the same executable dispatch", async () => {
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
        "  arxivId: 'web-63d7dedf6dd9973c',",
        "  paperPath: '.research/papers/web-63d7dedf6dd9973c/paper.md',",
        "  reused: false,",
        "  request,",
        "}));",
      ].join("\n"),
    );
    await chmod(executable, 0o755);
    vi.stubEnv("LATTICE_BIN", executable);

    const tools = makeLatticeLiteratureTools({
      resolveWorkspaceRoot: () => Effect.succeed(workspaceRoot),
      mutateBibliography: () => Effect.die("unexpected bibliography mutation"),
    });
    const capture = tools.find((tool) => tool.definition.name === "fetch_web_reference");
    expect(capture).toBeDefined();
    const result = await Effect.runPromise(
      capture!.handler(
        { url: "https://example.com/a-blog-post" },
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
    const payload = JSON.stringify(result);
    expect(payload).toContain("web-63d7dedf6dd9973c");
    // The stub echoes the dispatched request: the CLI tool tag and the URL
    // both arrived intact.
    expect(payload).toContain("fetch_web_reference");
    expect(payload).toContain("https://example.com/a-blog-post");
  });
});

import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("agent host profile", () => {
  it("keeps the upstream profile as the default", async () => {
    vi.stubEnv("AGENT_HOST_PROFILE", "");
    const { resolveAgentHostProfile } = await import("./hostProfile.ts");
    expect(resolveAgentHostProfile()).toMatchObject({
      id: "synara",
      mcpServerName: "synara",
    });
  });

  it("presents Lattice research and task tools without upstream branding", async () => {
    vi.stubEnv("AGENT_HOST_PROFILE", "lattice");
    const { adaptToolsForActiveHost, resolveAgentHostProfile } =
      await import("./hostProfile.ts");
    const tools = adaptToolsForActiveHost([
      {
        requiredCapability: "thread:read",
        definition: {
          name: "synara_context",
          description: "Inspect the current Synara harness.",
          inputSchema: { type: "object" },
          annotations: { title: "Synara context" },
        },
        handler: () =>
          Effect.succeed({
            content: [
              {
                type: "text" as const,
                text: '{"harness":"Synara","legacyEnv":"SYNARA_INTERNAL"}',
              },
            ],
          }),
      },
      {
        requiredCapability: "thread:write",
        definition: {
          name: "synara_create_thread",
          description: "Create a Synara thread.",
          inputSchema: {
            type: "object",
            properties: {
              model: {
                type: "string",
                description: "Use an exact value from synara_capabilities.",
              },
            },
          },
        },
        handler: () =>
          Effect.succeed({
            content: [{
              type: "text" as const,
              text: '{"nextTool":"synara_wait_for_threads"}',
            }],
          }),
      },
      {
        requiredCapability: "literature:write",
        definition: {
          name: "cite",
          description: "Add a citation.",
          inputSchema: { type: "object" },
        },
        handler: () => Effect.succeed({ content: [] }),
      },
    ]);

    expect(resolveAgentHostProfile()).toMatchObject({
      id: "lattice",
      displayName: "Lattice",
      mcpServerName: "lattice",
    });
    expect(tools.map((tool) => tool.definition.name)).toEqual([
      "context",
      "create_task",
      "cite",
    ]);
    expect(JSON.stringify(tools.map((tool) => tool.definition))).not.toMatch(/synara/i);

    const contextResult = await Effect.runPromise(
      tools[0]!.handler(
        {},
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
          callerCapabilities: new Set(["thread:read"]),
          callerTurnId: "turn",
          assertCallerTurnActive: () => Effect.void,
          jsonRpcRequestId: "request",
        },
      ),
    );
    expect(JSON.stringify(contextResult)).not.toMatch(/synara/i);
    expect(JSON.stringify(contextResult)).toContain("Lattice");

    const createResult = await Effect.runPromise(
      tools[1]!.handler(
        {},
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
          callerCapabilities: new Set(["thread:write"]),
          callerTurnId: "turn",
          assertCallerTurnActive: () => Effect.void,
          jsonRpcRequestId: "request",
        },
      ),
    );
    expect(JSON.stringify(createResult)).toContain("wait_for_tasks");
    expect(JSON.stringify(createResult)).not.toMatch(/synara/i);
  });

  it("describes bounded parallel task coordination without upstream identity", async () => {
    vi.stubEnv("AGENT_HOST_PROFILE", "lattice");
    const { renderSynaraHarnessPolicy } = await import("./harnessPolicy.ts");
    const policy = renderSynaraHarnessPolicy({ gatewayControlAvailable: true });
    expect(policy).toContain("one exact create_tasks batch");
    expect(policy).toContain("wait_for_tasks");
    expect(policy).toContain("Provider-native subagents");
    expect(policy).not.toMatch(/synara/i);
  });
});

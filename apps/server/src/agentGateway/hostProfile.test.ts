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

  it("presents only Lattice phase-one tools without upstream branding", async () => {
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
          inputSchema: { type: "object" },
        },
        handler: () => Effect.succeed({ content: [] }),
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
    expect(tools.map((tool) => tool.definition.name)).toEqual(["context", "cite"]);
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
  });
});

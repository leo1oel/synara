import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Lattice model boundary", () => {
  it("removes upstream branding from provider prompts and MCP identity", async () => {
    vi.stubEnv("AGENT_HOST_PROFILE", "lattice");
    const [
      harness,
      protocol,
      injection,
      codex,
      claude,
      planMode,
      debugMode,
      goalMode,
      checkpoints,
      hostProfile,
    ] = await Promise.all([
      import("./harnessPolicy.ts"),
      import("./protocol.ts"),
      import("./mcpInjection.ts"),
      import("../codexAppServerManager.ts"),
      import("../provider/Layers/ClaudeAdapter.ts"),
      import("../provider/planMode.ts"),
      import("../provider/debugMode.ts"),
      import("../provider/goalMode.ts"),
      import("../checkpointing/Utils.ts"),
      import("./hostProfile.ts"),
    ]);

    const modelVisible = JSON.stringify({
      harness: harness.renderSynaraHarnessPolicy({ gatewayControlAvailable: true }),
      sessionHarness: harness.takeSynaraHarnessPolicyForSession(
        {},
        { gatewayControlAvailable: true },
      ),
      mcp: protocol.buildMcpInitializeResult({
        requestedProtocolVersion: "2025-06-18",
        serverVersion: "test",
        instructions: "Lattice tools",
      }),
      mcpConfig: injection.buildCodexMcpConfigToml("http://127.0.0.1/mcp"),
      codexPlan: codex.CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
      codexDefault: codex.CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
      codexClient: codex.buildCodexInitializeParams(),
      claude: claude.buildEmbeddedClaudeSystemPromptAppend(true),
      genericPlan: planMode.PROVIDER_PLAN_MODE_PROMPT_PREFIX,
      genericDebug: debugMode.PROVIDER_DEBUG_MODE_PROMPT_PREFIX,
      goal: goalMode.withProviderGoalPrompt({ text: "continue", goal: "Finish the paper" }),
      goalContinuation: goalMode.buildGoalContinuationInput(),
      checkpointRefPrefix: checkpoints.CHECKPOINT_REFS_PREFIX,
    });

    expect(modelVisible).not.toMatch(/synara/i);
    expect(modelVisible).toContain("Lattice");
    expect(modelVisible).toContain("mcp_servers.lattice");
    expect(modelVisible).toContain("lattice_host_context");
    expect(modelVisible).toContain("lattice_debug_mode");
    expect(modelVisible).toContain("lattice_goal");
    expect(modelVisible).toContain("set_task_goal");
    expect(modelVisible).toContain("refs/lattice/checkpoints");
    expect(hostProfile.isThreadControlWithinActiveHostBoundary("project-a", "project-a")).toBe(
      true,
    );
    expect(hostProfile.isThreadControlWithinActiveHostBoundary("project-a", "project-b")).toBe(
      false,
    );
  });
});

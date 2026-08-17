import { describe, expect, it } from "vitest";

import {
  buildExternalMcpClientConfiguration,
  buildExternalMcpExamplePrompt,
  buildExternalMcpSetupPrompt,
  describeExternalMcpPermissions,
  describeExternalMcpProjects,
  externalMcpSetupAction,
} from "./externalMcpSetup";

const stdio = {
  command: "/Applications/Lattice.app/Contents/MacOS/Lattice",
  args: [
    "server.js",
    "mcp",
    "serve",
    "--integration",
    "mcp_int_example",
    "--home-dir",
    "/tmp/Lattice home",
  ],
  env: { ELECTRON_RUN_AS_NODE: "1" },
};

describe("external MCP guided setup", () => {
  it("builds copyable Codex and Claude Code commands without embedding a credential", () => {
    const codex = buildExternalMcpClientConfiguration("codex", stdio);
    const claude = buildExternalMcpClientConfiguration("claudeCode", stdio);

    expect(codex.value).toBe(
      "codex mcp add lattice --env ELECTRON_RUN_AS_NODE=1 -- /Applications/Lattice.app/Contents/MacOS/Lattice server.js mcp serve --integration mcp_int_example --home-dir '/tmp/Lattice home'",
    );
    expect(claude.value).toBe(
      "claude mcp add --scope user lattice -e ELECTRON_RUN_AS_NODE=1 -- /Applications/Lattice.app/Contents/MacOS/Lattice server.js mcp serve --integration mcp_int_example --home-dir '/tmp/Lattice home'",
    );
    expect(`${codex.value}${claude.value}`).not.toContain("syn_mcp_v1_");
  });

  it("builds standard JSON configuration for desktop and other clients", () => {
    const desktop = buildExternalMcpClientConfiguration("claudeDesktop", stdio);
    const parsed = JSON.parse(desktop.value) as {
      mcpServers: { lattice: { command: string; args: ReadonlyArray<string> } };
    };

    expect(desktop.format).toBe("json");
    expect(parsed.mcpServers.lattice).toEqual(stdio);
  });

  it("builds terminal commands for PowerShell on Windows", () => {
    const codex = buildExternalMcpClientConfiguration("codex", stdio, "Win32");
    expect(codex.value).toBe(
      "& 'codex' 'mcp' 'add' 'lattice' '--env' 'ELECTRON_RUN_AS_NODE=1' '--' '/Applications/Lattice.app/Contents/MacOS/Lattice' 'server.js' 'mcp' 'serve' '--integration' 'mcp_int_example' '--home-dir' '/tmp/Lattice home'",
    );
    expect(codex.instruction).toContain("PowerShell");
  });

  it("builds a project-specific prompt without exposing implementation identifiers", () => {
    const prompt = buildExternalMcpExamplePrompt("Lattice app");

    expect(prompt).toContain('project named "Lattice app"');
    expect(prompt).toContain("managed worktree");
    expect(prompt).toContain("approval-required");
    expect(prompt).not.toContain("projectId");
    expect(prompt).not.toContain("request ID");
    expect(prompt).not.toContain("mcp_int_");
  });

  it("builds one agent-facing setup prompt covering pairing, registration, and verification", () => {
    const prompt = buildExternalMcpSetupPrompt({
      setupCommand: "lattice mcp pair --code syn_pair_v1_example --home-dir /tmp/home",
      stdio,
    });

    expect(prompt).toContain("syn_pair_v1_example");
    expect(prompt).toContain("codex mcp add lattice");
    expect(prompt).toContain("claude mcp add --scope user lattice");
    expect(prompt).toContain('"mcpServers"');
    expect(prompt).toContain("overview tool");
    expect(prompt).not.toContain("Synara");
    expect(prompt).not.toContain("syn_mcp_v1_");
  });

  it("omits the pairing step once the computer is already paired", () => {
    const prompt = buildExternalMcpSetupPrompt({ setupCommand: null, stdio });

    expect(prompt).toContain("already completed");
    expect(prompt).not.toContain("syn_pair_v1_");
    expect(prompt).toContain("overview tool");
  });

  it("builds a discovery-first example prompt for all-projects connections", () => {
    const prompt = buildExternalMcpExamplePrompt(null);

    expect(prompt).toContain("overview tool");
    expect(prompt).toContain("managed worktree");
  });

  it("localizes copied setup instructions and prompts for Chinese interfaces", () => {
    const prompt = buildExternalMcpSetupPrompt({
      setupCommand: "lattice mcp pair --code syn_pair_v1_example --home-dir /tmp/home",
      stdio,
      locale: "zh-CN",
    });
    const example = buildExternalMcpExamplePrompt(null, "zh-CN");
    const codex = buildExternalMcpClientConfiguration("codex", stdio, "MacIntel", "zh-CN");

    expect(prompt).toContain("通过 MCP 将这个编码智能体连接到 Lattice");
    expect(prompt).toContain("第 3 步——验证连接");
    expect(example).toContain("使用 Lattice 创建一个新任务");
    expect(codex.copyLabel).toBe("复制 Codex 命令");
    expect(`${prompt}${example}${codex.instruction}`).not.toContain("Synara");
  });

  it("describes project access for both scopes", () => {
    expect(
      describeExternalMcpProjects({ projectScope: "all", allowedProjects: [{ title: "One" }] }),
    ).toBe("All projects, including future ones");
    expect(
      describeExternalMcpProjects({
        projectScope: "selected",
        allowedProjects: [{ title: "One" }, { title: "Two" }],
      }),
    ).toBe("One, Two");
  });

  it("describes scopes without exposing capability identifiers", () => {
    const description = describeExternalMcpPermissions([
      "projects:read",
      "tasks:create",
      "tasks:wait",
      "tasks:read",
      "runtime:local",
    ]);

    expect(description).toBe("Create and follow its own tasks · Use the shared local checkout");
    expect(description).not.toContain("runtime:local");
  });

  it("offers a non-destructive resume path when only the pairing code expired", () => {
    expect(
      externalMcpSetupAction({
        revoked: false,
        integrationExpired: false,
        paired: false,
        pairingExpired: true,
      }),
    ).toBe("resume-pairing");
    expect(
      externalMcpSetupAction({
        revoked: false,
        integrationExpired: true,
        paired: false,
        pairingExpired: true,
      }),
    ).toBe("revoke");
  });
});

import type {
  ExternalMcpCapability,
  ExternalMcpClientKind,
  ExternalMcpProjectScope,
  ExternalMcpStdioConfiguration,
} from "@synara/contracts";

export interface ExternalMcpClientConfiguration {
  readonly format: "command" | "json";
  readonly value: string;
  readonly copyLabel: string;
  readonly instruction: string;
}

export type ExternalMcpSetupAction = "resume-pairing" | "revoke" | "done" | null;
export type ExternalMcpDisplayLocale = "en" | "zh-CN";

export function externalMcpSetupAction(input: {
  readonly revoked: boolean;
  readonly integrationExpired: boolean;
  readonly paired: boolean;
  readonly pairingExpired: boolean;
}): ExternalMcpSetupAction {
  if (input.revoked || input.integrationExpired) return "revoke";
  if (!input.paired && input.pairingExpired) return "resume-pairing";
  return input.paired ? "done" : null;
}

function quoteShellArgument(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function shellCommand(parts: ReadonlyArray<string>, platform: string): string {
  if (/win/i.test(platform)) {
    return `& ${parts.map((part) => `'${part.replaceAll("'", "''")}'`).join(" ")}`;
  }
  return parts.map(quoteShellArgument).join(" ");
}

function jsonConfiguration(stdio: ExternalMcpStdioConfiguration): string {
  return JSON.stringify(
    {
      mcpServers: {
        lattice: {
          command: stdio.command,
          args: stdio.args,
          ...(stdio.env ? { env: stdio.env } : {}),
        },
      },
    },
    null,
    2,
  );
}

export function buildExternalMcpClientConfiguration(
  client: ExternalMcpClientKind,
  stdio: ExternalMcpStdioConfiguration,
  platform = "",
  locale: ExternalMcpDisplayLocale = "en",
): ExternalMcpClientConfiguration {
  const zh = locale === "zh-CN";
  if (client === "codex") {
    const environment = Object.entries(stdio.env ?? {}).flatMap(([key, value]) => [
      "--env",
      `${key}=${value}`,
    ]);
    return {
      format: "command",
      value: shellCommand(
        ["codex", "mcp", "add", "lattice", ...environment, "--", stdio.command, ...stdio.args],
        platform,
      ),
      copyLabel: zh ? "复制 Codex 命令" : "Copy Codex command",
      instruction: /win/i.test(platform)
        ? zh
          ? "在 PowerShell 中运行此命令。Codex 会将 Lattice 保存为本地 MCP 服务器；然后新建一个 Codex 任务。"
          : "Run this command in PowerShell. Codex will save Lattice as a local MCP server; then open a new Codex task."
        : zh
          ? "在终端中运行此命令。Codex 会将 Lattice 保存为本地 MCP 服务器；然后新建一个 Codex 任务。"
          : "Run this command in Terminal. Codex will save Lattice as a local MCP server; then open a new Codex task.",
    };
  }

  if (client === "claudeCode") {
    const environment = Object.entries(stdio.env ?? {}).flatMap(([key, value]) => [
      "-e",
      `${key}=${value}`,
    ]);
    return {
      format: "command",
      value: shellCommand(
        [
          "claude",
          "mcp",
          "add",
          "--scope",
          "user",
          "lattice",
          ...environment,
          "--",
          stdio.command,
          ...stdio.args,
        ],
        platform,
      ),
      copyLabel: zh ? "复制 Claude 命令" : "Copy Claude command",
      instruction: /win/i.test(platform)
        ? zh
          ? "在 PowerShell 中运行此命令。Claude Code 会让你的所有项目都能使用 Lattice。"
          : "Run this command in PowerShell. Claude Code will make Lattice available in all your projects."
        : zh
          ? "在终端中运行此命令。Claude Code 会让你的所有项目都能使用 Lattice。"
          : "Run this command in Terminal. Claude Code will make Lattice available in all your projects.",
    };
  }

  return {
    format: "json",
    value: jsonConfiguration(stdio),
    copyLabel: zh ? "复制配置" : "Copy configuration",
    instruction:
      client === "claudeDesktop"
        ? zh
          ? "在 Claude Desktop 中打开“设置 → 开发者 → 编辑配置”。添加 Lattice 条目且不要删除已有服务器，保存后重启 Claude Desktop。"
          : "In Claude Desktop, open Settings → Developer → Edit Config. Add the Lattice entry without removing existing servers, save, and restart Claude Desktop."
        : zh
          ? "将此内容粘贴到应用的本地 stdio MCP 配置中。"
          : "Paste this into your app's local stdio MCP configuration.",
  };
}

export function buildExternalMcpExamplePrompt(
  projectTitle: string | null,
  locale: ExternalMcpDisplayLocale = "en",
): string {
  if (locale === "zh-CN") {
    return [
      projectTitle === null
        ? "使用 Lattice 创建一个新任务：先调用新连接提供的概览工具，选择最相关的项目，并告诉我你选择了哪个项目。"
        : `使用 Lattice 在名为 ${JSON.stringify(projectTitle)} 的项目中创建一个新任务。`,
      "先检查 Lattice 的能力，并选择一个确实可用的服务商和模型；不要猜测模型名称。",
      "使用隔离的托管 worktree，并采用需要批准的执行模式。",
      "目标：[描述要完成的工作]。",
      "等待任务完成，然后读取结果并为我总结。",
    ].join("");
  }
  return [
    projectTitle === null
      ? "Use Lattice to create a new task: call the overview tool provided by the new connection first, pick the most relevant project, and tell me which one you chose."
      : `Use Lattice to create a new task in the project named ${JSON.stringify(projectTitle)}.`,
    "First inspect Lattice's capabilities and choose an exact available provider and model; do not guess model names.",
    "Use an isolated managed worktree and approval-required execution.",
    "Goal: [DESCRIBE THE WORK].",
    "Wait for the task to finish, then read the result and summarize it for me.",
  ].join(" ");
}

// The one block a user pastes into any coding agent (Codex, Claude Code, or
// another MCP-capable app). The agent pairs the machine, registers Lattice in
// its own MCP configuration, and verifies the connection — no per-client
// artifacts to juggle. `setupCommand` is null once pairing already happened.
export function buildExternalMcpSetupPrompt(input: {
  readonly setupCommand: string | null;
  readonly stdio: ExternalMcpStdioConfiguration;
  readonly platform?: string;
  readonly locale?: ExternalMcpDisplayLocale;
}): string {
  const platform = input.platform ?? "";
  const locale = input.locale ?? "en";
  const codex = buildExternalMcpClientConfiguration("codex", input.stdio, platform, locale);
  const claude = buildExternalMcpClientConfiguration("claudeCode", input.stdio, platform, locale);
  if (locale === "zh-CN") {
    const sections: string[] = [
      "通过 MCP 将这个编码智能体连接到 Lattice。请按顺序自行完成每一步，并报告执行结果。",
    ];
    if (input.setupCommand !== null) {
      sections.push(
        [
          "第 1 步——配对此电脑。在 shell 中运行下面这条完整命令。它会用一次性代码（有效期约 10 分钟）换取仅保存在此电脑上的私密凭据；MCP 配置中不会写入任何密钥：",
          "",
          input.setupCommand,
        ].join("\n"),
      );
    } else {
      sections.push("第 1 步——此电脑已完成配对，跳过这一步。");
    }
    sections.push(
      [
        '第 2 步——在你自己的配置中将 Lattice 注册为名为 "lattice" 的 stdio MCP 服务器，并使用你的应用支持的方式完成配置：',
        "",
        `如果你使用 Codex，请运行：${codex.value}`,
        `如果你使用 Claude Code，请运行：${claude.value}`,
        "如果你使用其他 MCP 应用，请将下面的内容合并到它的 MCP 配置中：",
        jsonConfiguration(input.stdio),
      ].join("\n"),
      "第 3 步——验证连接。如有需要，请重新加载 MCP 服务器；然后找到并调用新添加的 Lattice 服务器所提供的概览工具，总结它返回的项目、服务商和权限。",
    );
    return sections.join("\n\n");
  }
  const sections: string[] = [
    "Connect this coding agent to Lattice via MCP. Complete every step yourself, in order, and report what happened.",
  ];
  if (input.setupCommand !== null) {
    sections.push(
      [
        "Step 1 — Pair this computer. Run this exact command in a shell. It exchanges a one-time code (valid for about 10 minutes) for a private credential stored on this computer; no secret ever goes into your MCP configuration:",
        "",
        input.setupCommand,
      ].join("\n"),
    );
  } else {
    sections.push("Step 1 — Pairing is already completed on this computer. Skip it.");
  }
  sections.push(
    [
      'Step 2 — Register Lattice as a stdio MCP server named "lattice" in your own configuration, using whichever mechanism your app supports:',
      "",
      `If you are Codex, run: ${codex.value}`,
      `If you are Claude Code, run: ${claude.value}`,
      "For any other MCP app, merge this into its MCP configuration:",
      jsonConfiguration(input.stdio),
    ].join("\n"),
    "Step 3 — Verify. Reload your MCP servers if needed, then find and call the overview tool exposed by the newly added Lattice server. Summarize the projects, providers, and permissions it returns.",
  );
  return sections.join("\n\n");
}

export function describeExternalMcpProjects(
  input: {
    readonly projectScope?: ExternalMcpProjectScope | undefined;
    readonly allowedProjects: ReadonlyArray<{ readonly title: string }>;
  },
  locale: ExternalMcpDisplayLocale = "en",
): string {
  if (input.projectScope === "all") {
    return locale === "zh-CN"
      ? "所有项目，包括以后新增的项目"
      : "All projects, including future ones";
  }
  const titles = input.allowedProjects.map((project) => project.title);
  return titles.length > 0 ? titles.join(", ") : locale === "zh-CN" ? "没有项目" : "No projects";
}

export function describeExternalMcpPermissions(
  capabilities: ReadonlyArray<ExternalMcpCapability>,
  locale: ExternalMcpDisplayLocale = "en",
): string {
  const zh = locale === "zh-CN";
  const descriptions = [zh ? "创建并跟进由它发起的任务" : "Create and follow its own tasks"];
  if (capabilities.includes("tasks:read-project")) {
    descriptions.push(zh ? "读取所选项目中的其他任务" : "Read other tasks in selected projects");
  }
  if (capabilities.includes("runtime:local")) {
    descriptions.push(zh ? "使用共享的本地检出" : "Use the shared local checkout");
  }
  if (capabilities.includes("runtime:full-access")) {
    descriptions.push(zh ? "无需批准即可运行" : "Run without approval prompts");
  }
  return descriptions.join(" · ");
}

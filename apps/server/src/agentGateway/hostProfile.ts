import { Effect } from "effect";

import type { McpToolCallResult } from "./protocol.ts";
import type { ToolEntry } from "./toolRuntime.ts";

export type AgentHostProfileId = "synara" | "lattice";

export interface AgentHostProfile {
  readonly id: AgentHostProfileId;
  readonly displayName: string;
  readonly contextTag: string;
  readonly mcpServerName: string;
  readonly mcpServerTitle: string;
  readonly browserToolsEnabled: boolean;
}

const SYNARA_HOST_PROFILE: AgentHostProfile = {
  id: "synara",
  displayName: "Synara",
  contextTag: "synara_host_context",
  mcpServerName: "synara",
  mcpServerTitle: "Synara App Control",
  browserToolsEnabled: true,
};

const LATTICE_HOST_PROFILE: AgentHostProfile = {
  id: "lattice",
  displayName: "Lattice",
  contextTag: "lattice_host_context",
  mcpServerName: "lattice",
  mcpServerTitle: "Lattice Tools",
  browserToolsEnabled: false,
};

export function resolveAgentHostProfile(
  value = process.env.AGENT_HOST_PROFILE ?? process.env.SYNARA_HOST_PROFILE,
): AgentHostProfile {
  return value?.trim().toLowerCase() === "lattice" ? LATTICE_HOST_PROFILE : SYNARA_HOST_PROFILE;
}

export const ACTIVE_AGENT_HOST_PROFILE = resolveAgentHostProfile();

const LATTICE_TOOL_ALIASES = new Map<string, string>([
  ["synara_context", "context"],
  ["synara_capabilities", "agent_capabilities"],
  ["synara_list_projects", "list_projects"],
  ["synara_list_threads", "list_tasks"],
  ["synara_read_thread", "read_task"],
  ["synara_read_thread_activity", "read_task_activity"],
  ["synara_read_thread_events", "read_task_events"],
  ["synara_read_thread_runtime_events", "read_task_runtime_events"],
  ["synara_diagnose_thread", "diagnose_task"],
  ["synara_wait_for_threads", "wait_for_tasks"],
  ["synara_create_threads", "create_tasks"],
  ["synara_create_thread", "create_task"],
  ["synara_send_message", "send_message_to_task"],
  ["synara_interrupt_thread", "interrupt_task"],
  ["synara_set_thread_title", "set_task_title"],
  ["synara_set_thread_archived", "set_task_archived"],
]);

const LATTICE_NATIVE_TOOL_NAMES = new Set([
  "search_literature",
  "fetch_paper",
  "cite",
  "fetch_web_reference",
  "upgrade_bibliography",
  "remove_reference",
  "list_canvas_shapes",
  "create_canvas_shapes",
  "update_canvas_shapes",
  "delete_canvas_shapes",
]);

export function replaceModelVisibleHostBranding(value: string): string {
  if (ACTIVE_AGENT_HOST_PROFILE.id !== "lattice") return value;
  return value.replace(/synara/gi, (match) => {
    if (match === match.toUpperCase()) return "LATTICE";
    return match.startsWith("S") ? "Lattice" : "lattice";
  });
}

function replaceModelVisibleToolAliases(value: string): string {
  if (ACTIVE_AGENT_HOST_PROFILE.id !== "lattice") return value;
  let next = value;
  for (const [upstreamName, latticeName] of LATTICE_TOOL_ALIASES) {
    next = next.replaceAll(upstreamName, latticeName);
  }
  return replaceModelVisibleHostBranding(next);
}

function replaceStructuredBranding(value: unknown): unknown {
  if (typeof value === "string") return replaceModelVisibleToolAliases(value);
  if (Array.isArray(value)) return value.map(replaceStructuredBranding);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      replaceModelVisibleToolAliases(key),
      replaceStructuredBranding(nested),
    ]),
  );
}

function adaptToolResult(result: McpToolCallResult): McpToolCallResult {
  if (ACTIVE_AGENT_HOST_PROFILE.id !== "lattice") return result;
  return {
    ...result,
    content: result.content.map((part) =>
      part.type === "text" ? { ...part, text: replaceModelVisibleToolAliases(part.text) } : part,
    ),
    ...(result.structuredContent === undefined
      ? {}
      : {
          structuredContent: replaceStructuredBranding(result.structuredContent) as Record<
            string,
            unknown
          >,
        }),
  };
}

/**
 * Keep upstream tool implementations intact and adapt only their model-facing
 * catalog. Lattice exposes bounded task coordination while automation and
 * browser control remain unavailable.
 */
export function adaptToolsForActiveHost(tools: ReadonlyArray<ToolEntry>): ReadonlyArray<ToolEntry> {
  if (ACTIVE_AGENT_HOST_PROFILE.id !== "lattice") return tools;
  return tools.flatMap((tool) => {
    const alias = LATTICE_TOOL_ALIASES.get(tool.definition.name);
    if (!alias && !LATTICE_NATIVE_TOOL_NAMES.has(tool.definition.name)) return [];
    return [
      {
        ...tool,
        definition: {
          ...tool.definition,
          name: alias ?? tool.definition.name,
          description: replaceModelVisibleToolAliases(tool.definition.description),
          inputSchema: replaceStructuredBranding(
            tool.definition.inputSchema,
          ) as typeof tool.definition.inputSchema,
          ...(tool.definition.annotations === undefined
            ? {}
            : {
                annotations: {
                  ...tool.definition.annotations,
                  ...(tool.definition.annotations.title === undefined
                    ? {}
                    : {
                        title: replaceModelVisibleToolAliases(tool.definition.annotations.title),
                      }),
                },
              }),
        },
        handler: (args, context) => tool.handler(args, context).pipe(Effect.map(adaptToolResult)),
      },
    ];
  });
}

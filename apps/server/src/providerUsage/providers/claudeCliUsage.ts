// FILE: providerUsage/providers/claudeCliUsage.ts
// Purpose: Ask the Claude CLI itself for plan usage when this process cannot read the login.
//
// The usage fetcher reads the OAuth credential where a plain `claude` keeps it. A wrapper that
// sets CLAUDE_CONFIG_DIR for its own child (account switchers such as cac, a shell function, a
// launcher script) keeps the login in a config-dir-scoped Keychain item this process cannot
// name, so chats work while usage reports "not signed in" and the usage chip disappears.
// The CLI resolves its own login, so the Agent SDK's `/usage` control request answers with the
// same 5-hour, weekly and per-model windows. The request is experimental in the SDK; a CLI
// without it, or without plan limits (API key, Bedrock, Vertex), resolves to null and the caller
// keeps its needs-auth answer.

import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import { createLogger } from "../../logger";
import { loadClaudeAgentSdk } from "../../provider/claudeAgentSdk";
import { buildClaudeProcessEnv } from "../../provider/claudeProcessEnv";
import { asRecord, asString } from "../parse";
import type { ProviderUsageContext } from "../types";

const log = createLogger("provider-usage:claude-cli");

const CLI_USAGE_TIMEOUT_MS = 20_000;
// Spawning the CLI costs a process start, so a CLI that cannot answer is not asked again for a
// while. A successful answer is cached by the snapshot cache like any other live read.
const CLI_USAGE_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;

export interface ClaudeCliUsage {
  /** The usage endpoint's JSON shape, which `parseClaudeUsage` already reads. */
  readonly json: Record<string, unknown>;
  readonly subscriptionType: string | undefined;
}

export type ReadClaudeCliUsage = (input: {
  binaryPath: string;
  env: NodeJS.ProcessEnv;
}) => Promise<unknown>;

const notBeforeMs = new Map<string, number>();

function cooldownKey(ctx: ProviderUsageContext): string {
  return `${ctx.claudeBinaryPath?.trim() || "claude"}:${ctx.homeDir}:${ctx.env.CLAUDE_CONFIG_DIR ?? ""}`;
}

/** Test-only: forget which CLIs failed to answer. */
export function __resetClaudeCliUsageCooldownForTests(): void {
  notBeforeMs.clear();
}

/** Start the CLI through the Agent SDK, ask for `/usage`, and stop it. */
export const readClaudeCliUsageThroughSdk: ReadClaudeCliUsage = async ({ binaryPath, env }) => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CLI_USAGE_TIMEOUT_MS);
  try {
    const { query } = await loadClaudeAgentSdk();
    const q = query({
      // oxlint-disable-next-line require-yield
      prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
        await new Promise<void>((resolve) => {
          if (abort.signal.aborted) resolve();
          else abort.signal.addEventListener("abort", () => resolve(), { once: true });
        });
      })(),
      options: {
        persistSession: false,
        abortController: abort,
        pathToClaudeCodeExecutable: binaryPath,
        // No settings sources: a usage read must not run the user's hooks, plugins or MCP servers.
        settingSources: [],
        strictMcpConfig: true,
        allowedTools: [],
        env,
        stderr: () => {},
      },
    });
    const readUsage = (q as unknown as Record<string, unknown>)
      .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    if (typeof readUsage !== "function") {
      return null;
    }
    await q.initializationResult();
    return await (readUsage as (opts: { skipBehaviors: boolean }) => Promise<unknown>).call(q, {
      skipBehaviors: true,
    });
  } finally {
    clearTimeout(timer);
    if (!abort.signal.aborted) abort.abort();
  }
};

function window(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  return record ? { utilization: record.utilization, resets_at: record.resets_at } : undefined;
}

/** Map the SDK's `/usage` answer onto the usage endpoint's JSON. Null when it has no plan limits. */
export function claudeCliUsageToEndpointJson(response: unknown): ClaudeCliUsage | null {
  const root = asRecord(response);
  const limits = asRecord(root?.rate_limits);
  if (!root || root.rate_limits_available !== true || !limits) {
    return null;
  }
  const modelScoped = Array.isArray(limits.model_scoped) ? limits.model_scoped : [];
  return {
    json: {
      five_hour: window(limits.five_hour),
      seven_day: window(limits.seven_day),
      seven_day_opus: window(limits.seven_day_opus),
      seven_day_sonnet: window(limits.seven_day_sonnet),
      limits: modelScoped.flatMap((entry) => {
        const scoped = asRecord(entry);
        const displayName = asString(scoped?.display_name);
        if (!scoped || !displayName) return [];
        return [
          {
            kind: "weekly_scoped",
            scope: { model: { display_name: displayName } },
            percent: scoped.utilization,
            resets_at: scoped.resets_at,
          },
        ];
      }),
      extra_usage: limits.extra_usage,
    },
    subscriptionType: asString(root.subscription_type),
  };
}

/** Ask the configured Claude CLI for plan usage. Never throws; null when it cannot answer. */
export async function readClaudeUsageFromCli(
  ctx: ProviderUsageContext,
  deps: {
    acquireLock: () => Promise<() => void>;
    readUsage: ReadClaudeCliUsage;
  },
): Promise<ClaudeCliUsage | null> {
  const key = cooldownKey(ctx);
  if (ctx.nowMs < (notBeforeMs.get(key) ?? 0)) {
    return null;
  }
  // The CLI may redeem its rotating refresh token while it starts, so it takes the same lock as
  // every other `claude` the server runs for auth.
  const release = await deps.acquireLock();
  let usage: ClaudeCliUsage | null = null;
  try {
    usage = claudeCliUsageToEndpointJson(
      await deps.readUsage({
        binaryPath: ctx.claudeBinaryPath?.trim() || "claude",
        env: buildClaudeProcessEnv({
          env: ctx.env,
          ...(ctx.homeDir ? { homeDir: ctx.homeDir } : {}),
        }),
      }),
    );
  } catch (cause) {
    log.warn("claude CLI usage read failed", {
      message: cause instanceof Error ? cause.message : String(cause),
    });
  } finally {
    release();
  }
  if (usage) {
    notBeforeMs.delete(key);
  } else {
    notBeforeMs.set(key, ctx.nowMs + CLI_USAGE_FAILURE_COOLDOWN_MS);
  }
  return usage;
}

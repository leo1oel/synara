// FILE: providerUsage/keychainPrompts.test.ts
// Purpose: Regression for repeated macOS Keychain prompts. Every `security find-generic-password`
// read of an item whose ACL lacks `security` raises a SecurityAgent prompt, so periodic usage
// refreshes must read each item at most once and must not retry a denied or failed read until
// the user explicitly refreshes. `security` is faked at the exec boundary; the real Keychain is
// never touched.

import { createCipheriv, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { outboundHttp } from "@synara/shared/outboundHttp";

type FakeOutcome =
  | { kind: "granted"; value: string }
  | { kind: "missing" }
  | { kind: "denied" }
  | { kind: "timeout" };

const fakeSecurity = vi.hoisted(() => ({
  calls: [] as Array<{ file: string; service: string; account: string | null }>,
  items: new Map<string, () => FakeOutcome>(),
  gate: null as Promise<void> | null,
}));

function itemKey(service: string, account: string | null): string {
  return `${service}\u0000${account ?? ""}`;
}

// One fake for every exec path: credentials.ts (promisified), droidSecureStorage.ts (callback),
// and cursorSafeStorage.ts (through the shared process runtime). Any non-`security` exec fails.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  type Callback = (error: Error | null, stdout: string, stderr: string) => void;
  const run = (file: string, args: ReadonlyArray<string>, callback: Callback) => {
    const flag = (name: string) => {
      const index = args.indexOf(name);
      return index >= 0 ? (args[index + 1] ?? null) : null;
    };
    if (nodePath.basename(file) !== "security" || args[0] !== "find-generic-password") {
      queueMicrotask(() => callback(new Error(`unexpected exec ${file}`), "", ""));
      return;
    }
    const service = flag("-s") ?? "";
    const account = flag("-a");
    fakeSecurity.calls.push({ file, service, account });
    const respond = () => {
      const outcome = fakeSecurity.items.get(itemKey(service, account))?.() ?? { kind: "missing" };
      if (outcome.kind === "granted") {
        callback(null, `${outcome.value}\n`, "");
        return;
      }
      const error = Object.assign(new Error("security failed"), {
        code: outcome.kind === "missing" ? 44 : outcome.kind === "denied" ? 51 : null,
        killed: outcome.kind === "timeout",
        signal: outcome.kind === "timeout" ? "SIGTERM" : null,
      });
      callback(error, "", "");
    };
    void (fakeSecurity.gate ?? Promise.resolve()).then(respond);
  };
  const execFile = Object.assign(
    (file: string, args: ReadonlyArray<string>, _options: unknown, callback: Callback) => {
      run(file, args, callback);
      return { stdin: { end() {} }, on() {}, once() {}, pid: 1 };
    },
    {
      [promisify.custom]: (file: string, args: ReadonlyArray<string>) =>
        new Promise((resolve, reject) =>
          run(file, args, (error, stdout, stderr) =>
            error ? reject(error) : resolve({ stdout, stderr }),
          ),
        ),
    },
  );
  return { ...actual, execFile, default: { ...actual, execFile } };
});

vi.mock("../providerUsageSnapshot", () => ({
  loadLocalProviderUsageLines: async () => [],
}));

const { __resetProviderUsageCacheForTests, collectProviderUsageSnapshots } =
  await import("./index");
const { __resetClaudeUsageRateLimitState, __setClaudeAuthNudgeDepsForTests } =
  await import("./providers/claude");
const { __resetDroidUsageRateLimitState } = await import("./providers/droid");
const { __resetKeychainReadsForTests } = await import("./keychainReads");

const NOW_MS = 1_780_000_000_000;
const MINUTE_MS = 60_000;
const CLAUDE_SERVICE = "Claude Code-credentials";
const FACTORY_SERVICE = "Factory CLI";
const FACTORY_ACCOUNT = "auth-encryption-key-security-cli";
const tempDirs: string[] = [];

function makeHome(): string {
  const homeDir = mkdtempSync(nodePath.join(os.tmpdir(), "synara-keychain-prompts-"));
  tempDirs.push(homeDir);
  return homeDir;
}

function jwtExpiring(expiresAtMs: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(expiresAtMs / 1000) })).toString(
    "base64url",
  );
  return `header.${payload}.signature`;
}

function writeFactoryLogin(homeDir: string, key: Buffer, accessToken: string): void {
  const factoryHome = nodePath.join(homeDir, ".factory");
  mkdirSync(factoryHome, { recursive: true });
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ access_token: accessToken }), "utf8"),
    cipher.final(),
  ]);
  writeFileSync(
    nodePath.join(factoryHome, "auth.v2.loginkeychain"),
    [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64")).join(":"),
    "utf8",
  );
}

function claudeKeychainValue(accessToken: string): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken,
      expiresAt: NOW_MS + 8 * 60 * MINUTE_MS,
      scopes: ["user:profile"],
    },
  });
}

function stubUsageEndpoints(): void {
  vi.spyOn(outboundHttp, "request").mockImplementation(async (input) => {
    const url = String(input.url);
    const json = url.includes("anthropic.com")
      ? { five_hour: { utilization: 12 } }
      : {
          usesTokenRateLimitsBilling: true,
          limits: {
            standard: {
              fiveHour: { usedPercent: 15, windowEnd: "2026-09-04T02:36:34.535Z" },
            },
          },
        };
    return {
      status: 200,
      headers: new Headers({ "Content-Type": "application/json" }),
      body: new TextEncoder().encode(JSON.stringify(json)),
      url,
    };
  });
}

function callsFor(service: string): number {
  return fakeSecurity.calls.filter((call) => call.service === service).length;
}

async function refresh(homeDir: string, nowMs: number, forceRefresh = false) {
  return collectProviderUsageSnapshots(
    { homeDir, env: { USER: "tester", HOME: homeDir }, platform: "darwin", nowMs },
    { providers: ["claudeAgent", "droid"], forceRefresh },
  );
}

/** The usage panel and header chip poll; advance past every snapshot TTL between rounds. */
async function pollRounds(homeDir: string, rounds: number) {
  let last: Awaited<ReturnType<typeof refresh>> = [];
  for (let round = 0; round < rounds; round += 1) {
    last = await refresh(homeDir, NOW_MS + round * 6 * MINUTE_MS);
  }
  return last;
}

beforeEach(() => {
  fakeSecurity.calls.length = 0;
  fakeSecurity.items.clear();
  fakeSecurity.gate = null;
  __resetProviderUsageCacheForTests();
  __resetClaudeUsageRateLimitState();
  __resetDroidUsageRateLimitState();
  __resetKeychainReadsForTests();
  // No test may exec a real `claude` binary or take the process-wide auth-status lock.
  __setClaudeAuthNudgeDepsForTests({
    acquireLock: async () => () => {},
    runAuthStatus: async () => {},
  });
  stubUsageEndpoints();
});

afterEach(() => {
  vi.restoreAllMocks();
  __setClaudeAuthNudgeDepsForTests(null);
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("keychain prompts across usage refreshes", () => {
  it("reads each granted item once and keeps showing usage", async () => {
    const homeDir = makeHome();
    const factoryKey = randomBytes(32);
    writeFactoryLogin(homeDir, factoryKey, jwtExpiring(NOW_MS + 24 * 60 * MINUTE_MS));
    fakeSecurity.items.set(itemKey(CLAUDE_SERVICE, "tester"), () => ({
      kind: "granted",
      value: claudeKeychainValue("claude-token"),
    }));
    fakeSecurity.items.set(itemKey(FACTORY_SERVICE, FACTORY_ACCOUNT), () => ({
      kind: "granted",
      value: factoryKey.toString("base64"),
    }));

    const snapshots = await pollRounds(homeDir, 10);

    expect(callsFor(CLAUDE_SERVICE)).toBe(1);
    expect(callsFor(FACTORY_SERVICE)).toBe(1);
    expect(snapshots.find((snapshot) => snapshot.provider === "claudeAgent")?.status).toBe("ok");
    expect(snapshots.find((snapshot) => snapshot.provider === "droid")?.status).toBe("ok");
  });

  it.each([
    ["denied", { kind: "denied" } as const],
    ["timed out", { kind: "timeout" } as const],
  ])("does not retry a %s read until the user explicitly refreshes", async (_label, outcome) => {
    const homeDir = makeHome();
    writeFactoryLogin(homeDir, randomBytes(32), jwtExpiring(NOW_MS + 24 * 60 * MINUTE_MS));
    fakeSecurity.items.set(itemKey(CLAUDE_SERVICE, "tester"), () => outcome);
    fakeSecurity.items.set(itemKey(CLAUDE_SERVICE, null), () => outcome);
    fakeSecurity.items.set(itemKey(FACTORY_SERVICE, FACTORY_ACCOUNT), () => outcome);

    await pollRounds(homeDir, 10);

    // One prompt per item, and a refused account item never falls through to a second prompt.
    expect(callsFor(CLAUDE_SERVICE)).toBe(1);
    expect(callsFor(FACTORY_SERVICE)).toBe(1);

    await refresh(homeDir, NOW_MS + 70 * MINUTE_MS, true);
    expect(callsFor(CLAUDE_SERVICE)).toBe(2);
    expect(callsFor(FACTORY_SERVICE)).toBe(2);

    await pollRounds(homeDir, 3);
    expect(callsFor(CLAUDE_SERVICE)).toBe(2);
    expect(callsFor(FACTORY_SERVICE)).toBe(2);
  });

  it("keeps a refused Factory key when droid rewrites its credential file", async () => {
    const homeDir = makeHome();
    writeFactoryLogin(homeDir, randomBytes(32), jwtExpiring(NOW_MS + 24 * 60 * MINUTE_MS));
    fakeSecurity.items.set(itemKey(FACTORY_SERVICE, FACTORY_ACCOUNT), () => ({ kind: "denied" }));

    await pollRounds(homeDir, 5);
    expect(callsFor(FACTORY_SERVICE)).toBe(1);

    // A routine token refresh re-encrypts auth.v2.loginkeychain; it is not a reason to prompt.
    writeFactoryLogin(homeDir, randomBytes(32), jwtExpiring(NOW_MS + 48 * 60 * MINUTE_MS));
    await pollRounds(homeDir, 5);
    expect(callsFor(FACTORY_SERVICE)).toBe(1);

    await refresh(homeDir, NOW_MS + 70 * MINUTE_MS, true);
    await pollRounds(homeDir, 3);
    expect(callsFor(FACTORY_SERVICE)).toBe(2);
  });

  it("prompts once per usage refresh for a Factory key that no longer opens the file", async () => {
    const homeDir = makeHome();
    writeFactoryLogin(homeDir, randomBytes(32), jwtExpiring(NOW_MS + 24 * 60 * MINUTE_MS));
    const staleKey = randomBytes(32).toString("base64");
    fakeSecurity.items.set(itemKey(FACTORY_SERVICE, FACTORY_ACCOUNT), () => ({
      kind: "granted",
      value: staleKey,
    }));

    await refresh(homeDir, NOW_MS);
    expect(callsFor(FACTORY_SERVICE)).toBe(1);

    // A later refresh re-reads the remembered key once; the Keychain still holds it.
    await pollRounds(homeDir, 5);
    expect(callsFor(FACTORY_SERVICE)).toBe(2);
  });

  it("re-reads a legacy Cursor Keychain token once after it expires", async () => {
    const homeDir = makeHome();
    let token = jwtExpiring(NOW_MS - MINUTE_MS);
    fakeSecurity.items.set(itemKey("cursor-access-token", null), () => ({
      kind: "granted",
      value: token,
    }));
    const refreshCursor = (nowMs: number) =>
      collectProviderUsageSnapshots(
        { homeDir, env: { USER: "tester", HOME: homeDir }, platform: "darwin", nowMs },
        { providers: ["cursor"] },
      );

    const [expired] = await refreshCursor(NOW_MS);
    expect(expired?.status).toBe("needs-auth");
    expect(callsFor("cursor-access-token")).toBe(1);

    token = jwtExpiring(NOW_MS + 24 * 60 * MINUTE_MS);
    let snapshots: Awaited<ReturnType<typeof refreshCursor>> = [];
    for (let round = 1; round <= 5; round += 1) {
      snapshots = await refreshCursor(NOW_MS + round * 6 * MINUTE_MS);
    }
    expect(snapshots[0]?.status).toBe("ok");
    expect(callsFor("cursor-access-token")).toBe(2);
  });

  it("re-reads the Claude item once after the CLI refreshes an expired token", async () => {
    const homeDir = makeHome();
    let stored = JSON.stringify({
      claudeAiOauth: {
        accessToken: "expired",
        expiresAt: NOW_MS - MINUTE_MS,
        scopes: ["user:profile"],
      },
    });
    fakeSecurity.items.set(itemKey(CLAUDE_SERVICE, "tester"), () => ({
      kind: "granted",
      value: stored,
    }));
    __setClaudeAuthNudgeDepsForTests({
      acquireLock: async () => () => {},
      runAuthStatus: async () => {
        stored = claudeKeychainValue("rotated");
      },
    });

    const snapshots = await pollRounds(homeDir, 5);

    expect(callsFor(CLAUDE_SERVICE)).toBe(2);
    expect(snapshots.find((snapshot) => snapshot.provider === "claudeAgent")?.status).toBe("ok");
  });

  it("does not re-read a valid Claude Keychain item for a stale credentials file", async () => {
    const homeDir = makeHome();
    mkdirSync(nodePath.join(homeDir, ".claude"), { recursive: true });
    writeFileSync(
      nodePath.join(homeDir, ".claude", ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "leftover",
          expiresAt: NOW_MS - MINUTE_MS,
          scopes: ["user:profile"],
        },
      }),
      "utf8",
    );
    fakeSecurity.items.set(itemKey(CLAUDE_SERVICE, "tester"), () => ({
      kind: "granted",
      value: claudeKeychainValue("claude-token"),
    }));

    await pollRounds(homeDir, 5);
    await refresh(homeDir, NOW_MS + 70 * MINUTE_MS, true);
    const snapshots = await refresh(homeDir, NOW_MS + 80 * MINUTE_MS, true);

    expect(callsFor(CLAUDE_SERVICE)).toBe(1);
    expect(snapshots.find((snapshot) => snapshot.provider === "claudeAgent")?.status).toBe("ok");
  });

  it("falls back to the service-only Claude item only when the account item is missing", async () => {
    const homeDir = makeHome();
    fakeSecurity.items.set(itemKey(CLAUDE_SERVICE, null), () => ({
      kind: "granted",
      value: claudeKeychainValue("claude-token"),
    }));

    const snapshots = await pollRounds(homeDir, 10);

    expect(fakeSecurity.calls.filter((call) => call.account === "tester")).toHaveLength(1);
    expect(fakeSecurity.calls.filter((call) => call.account === null)).toHaveLength(1);
    expect(snapshots.find((snapshot) => snapshot.provider === "claudeAgent")?.status).toBe("ok");
  });

  it("shares one in-flight read between concurrent refreshes", async () => {
    const homeDir = makeHome();
    let release!: () => void;
    fakeSecurity.gate = new Promise((resolve) => {
      release = resolve;
    });
    fakeSecurity.items.set(itemKey(CLAUDE_SERVICE, "tester"), () => ({
      kind: "granted",
      value: claudeKeychainValue("claude-token"),
    }));

    const pending = Promise.all([
      refresh(homeDir, NOW_MS),
      refresh(homeDir, NOW_MS, true),
      refresh(homeDir, NOW_MS + MINUTE_MS),
    ]);
    await vi.waitFor(() => expect(callsFor(CLAUDE_SERVICE)).toBe(1));
    release();
    await pending;

    expect(callsFor(CLAUDE_SERVICE)).toBe(1);
  });
});

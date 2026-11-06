// FILE: providerUsage/keychainReads.test.ts
// Purpose: Covers the Keychain read memory policy: granted secrets are reused, refusals are
// remembered until an explicit refresh or a credential-file change, absent items are re-checked
// after a short TTL, and a re-read for a rejected token runs once per secret.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetKeychainReadsForTests,
  classifySecurityResult,
  forgetUnavailableKeychainReads,
  type KeychainReadOutcome,
  readKeychainItemOnce,
} from "./keychainReads";

const ITEM = { service: "Example", account: "tester" };

function reader(...outcomes: KeychainReadOutcome[]) {
  return vi.fn(async () => outcomes.shift() ?? { kind: "missing" as const });
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_780_000_000_000 });
  __resetKeychainReadsForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("classifySecurityResult", () => {
  it.each([
    ["a secret", null, "secret\n", { kind: "granted", value: "secret" }],
    ["empty output", null, " \n", { kind: "missing" }],
    ["exit 44", Object.assign(new Error("x"), { code: 44 }), "", { kind: "missing" }],
    ["a refused prompt", Object.assign(new Error("x"), { code: 51 }), "", { kind: "denied" }],
    ["a timeout", Object.assign(new Error("x"), { killed: true }), "", { kind: "failed" }],
    ["a spawn error", Object.assign(new Error("x"), { code: "ENOENT" }), "", { kind: "failed" }],
  ] as const)("maps %s", (_label, error, stdout, expected) => {
    expect(classifySecurityResult(error, stdout)).toEqual(expected);
  });
});

describe("readKeychainItemOnce", () => {
  it("reuses a granted secret until its long TTL", async () => {
    const read = reader({ kind: "granted", value: "a" }, { kind: "granted", value: "b" });
    await readKeychainItemOnce(ITEM, read);
    vi.advanceTimersByTime(11 * 60 * 60 * 1000);
    expect(await readKeychainItemOnce(ITEM, read)).toEqual({ kind: "granted", value: "a" });
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(await readKeychainItemOnce(ITEM, read)).toEqual({ kind: "granted", value: "b" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps a refusal until an explicit refresh, then reads once", async () => {
    const read = reader({ kind: "denied" }, { kind: "granted", value: "a" });
    await readKeychainItemOnce(ITEM, read);
    vi.advanceTimersByTime(48 * 60 * 60 * 1000);
    expect(await readKeychainItemOnce(ITEM, read)).toEqual({ kind: "denied" });
    expect(await readKeychainItemOnce(ITEM, read, { reread: true })).toEqual({ kind: "denied" });
    forgetUnavailableKeychainReads();
    expect(await readKeychainItemOnce(ITEM, read)).toEqual({ kind: "granted", value: "a" });
    forgetUnavailableKeychainReads();
    await readKeychainItemOnce(ITEM, read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("retries a remembered failure when the credential file changes", async () => {
    const read = reader({ kind: "failed" }, { kind: "granted", value: "a" });
    await readKeychainItemOnce(ITEM, read, { generation: "login-1" });
    await readKeychainItemOnce(ITEM, read, { generation: "login-1" });
    expect(await readKeychainItemOnce(ITEM, read, { generation: "login-2" })).toEqual({
      kind: "granted",
      value: "a",
    });
    // A granted secret survives later file rewrites (token refreshes).
    await readKeychainItemOnce(ITEM, read, { generation: "login-3" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("re-checks an absent item after a short TTL, which never prompts", async () => {
    const read = reader({ kind: "missing" }, { kind: "granted", value: "a" });
    await readKeychainItemOnce(ITEM, read);
    await readKeychainItemOnce(ITEM, read);
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(await readKeychainItemOnce(ITEM, read)).toEqual({ kind: "granted", value: "a" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("re-reads once for a rejected token and stops when the Keychain still holds it", async () => {
    const read = reader(
      { kind: "granted", value: "old" },
      { kind: "granted", value: "old" },
      { kind: "granted", value: "new" },
    );
    await readKeychainItemOnce(ITEM, read);
    expect(await readKeychainItemOnce(ITEM, read, { reread: true })).toEqual({
      kind: "granted",
      value: "old",
    });
    await readKeychainItemOnce(ITEM, read, { reread: true });
    await readKeychainItemOnce(ITEM, read, { reread: true });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight read and remembers a thrown reader as a failure", async () => {
    let fail!: (error: Error) => void;
    const read = vi.fn(
      () =>
        new Promise<KeychainReadOutcome>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const reads = [readKeychainItemOnce(ITEM, read), readKeychainItemOnce(ITEM, read)];
    fail(new Error("spawn failed"));
    expect(await Promise.all(reads)).toEqual([{ kind: "failed" }, { kind: "failed" }]);
    expect(await readKeychainItemOnce(ITEM, read)).toEqual({ kind: "failed" });
    expect(read).toHaveBeenCalledTimes(1);
  });
});

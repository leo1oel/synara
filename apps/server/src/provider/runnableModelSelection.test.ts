import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type ProviderKind,
  type ServerProviderStatus,
  type ServerSettings,
} from "@synara/contracts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Ref } from "effect";
import { describe, expect, it } from "vitest";

import {
  providerCliFound,
  readProviderHealthForAuxiliaryModel,
  resolveRunnableModelSelection,
  type ProviderCliFound,
} from "./runnableModelSelection.ts";
import type { ProviderHealthShape } from "./Services/ProviderHealth.ts";

function status(
  provider: ProviderKind,
  health: "ready" | "missing" | "signed-out" = "ready",
): ServerProviderStatus {
  return {
    provider,
    driver: provider,
    instanceId: provider,
    enabled: true,
    status: health === "ready" ? "ready" : "error",
    available: health !== "missing",
    authStatus: health === "signed-out" ? "unauthenticated" : "authenticated",
    checkedAt: "2026-01-01T00:00:00.000Z",
  } as ServerProviderStatus;
}

const settings = DEFAULT_SERVER_SETTINGS;
const codexDefault = settings.textGenerationModelSelection;
const claude: ModelSelection = { provider: "claudeAgent", model: "claude-opus-5-5" };

describe("resolveRunnableModelSelection", () => {
  it("falls back to the first ready provider's default model when the default Codex is missing", () => {
    expect(
      resolveRunnableModelSelection({
        settings,
        preferences: [codexDefault],
        statuses: [status("codex", "missing"), status("claudeAgent")],
        purpose: "text-generation",
      }),
    ).toEqual({
      kind: "fallback",
      selection: {
        provider: "claudeAgent",
        instanceId: "claudeAgent",
        model: DEFAULT_MODEL_BY_PROVIDER.claudeAgent,
      },
    });
  });

  it("keeps a ready Settings choice even when an earlier provider is also ready", () => {
    expect(
      resolveRunnableModelSelection({
        settings,
        preferences: [claude],
        statuses: [status("codex"), status("claudeAgent")],
        purpose: "text-generation",
      }),
    ).toEqual({ kind: "selected", preference: 0, selection: claude });
  });

  it("keeps a Settings choice whose health has not been probed yet", () => {
    expect(
      resolveRunnableModelSelection({
        settings,
        preferences: [claude],
        statuses: [],
        purpose: "text-generation",
      }),
    ).toMatchObject({ kind: "selected", selection: claude });
  });

  it("tries each preference before falling back, skipping signed-out providers", () => {
    expect(
      resolveRunnableModelSelection({
        settings,
        preferences: [codexDefault, claude],
        statuses: [status("codex", "signed-out"), status("claudeAgent")],
        purpose: "text-generation",
      }),
    ).toEqual({ kind: "selected", preference: 1, selection: claude });
  });

  it("never falls back to a provider disabled in settings, even when it is installed", () => {
    const codexOff: ServerSettings = {
      ...settings,
      providers: {
        ...settings.providers,
        codex: { ...settings.providers.codex, enabled: false },
      },
    };
    expect(
      resolveRunnableModelSelection({
        settings: codexOff,
        preferences: [codexDefault],
        statuses: [status("codex"), status("claudeAgent", "missing")],
        purpose: "text-generation",
      }),
    ).toMatchObject({ kind: "unavailable" });
  });

  it("lets an agent-turn purpose (compile repair) fall back to any built-in provider", () => {
    const grokOnly = [status("codex", "missing"), status("claudeAgent", "missing"), status("grok")];
    expect(
      resolveRunnableModelSelection({
        settings,
        preferences: [settings.compileRepairModelSelection],
        statuses: grokOnly,
        purpose: "agent-turn",
      }),
    ).toMatchObject({ kind: "fallback", selection: { provider: "grok" } });
    // Grok has no text-generation path, so proofreading cannot use it.
    expect(
      resolveRunnableModelSelection({
        settings,
        preferences: [codexDefault],
        statuses: grokOnly,
        purpose: "text-generation",
      }),
    ).toMatchObject({ kind: "unavailable" });
  });

  it("names the enabled providers that can be connected, and where", () => {
    expect(
      resolveRunnableModelSelection({
        settings,
        preferences: [codexDefault],
        statuses: [status("codex", "missing"), status("claudeAgent", "signed-out")],
        purpose: "text-generation",
      }),
    ).toEqual({
      kind: "unavailable",
      message:
        "No AI provider is connected. Connect Codex, Claude, Cursor, OpenCode or Droid in the Agent panel → Settings → Providers.",
    });
  });
});

// Claude installed, Codex not: what a Claude-only writer's machine reports.
const claudeOnlyCli: ProviderCliFound = (instance) =>
  instance.driver === "claudeAgent" ? true : instance.driver === "codex" ? false : undefined;
const bothCli: ProviderCliFound = (instance) =>
  instance.driver === "claudeAgent" || instance.driver === "codex" ? true : undefined;

describe("before the first provider probe", () => {
  /**
   * ProviderHealth right after launch: no status until `refresh` (the first
   * probe) finishes, which takes `probe` (or never ends when it is `never`).
   */
  function freshHealth(
    probe: { readonly result: ReadonlyArray<ServerProviderStatus> } | "never",
    initial: ReadonlyArray<ServerProviderStatus> = [],
  ) {
    return Effect.gen(function* () {
      const statuses = yield* Ref.make(initial);
      const refreshes = yield* Ref.make(0);
      const providerHealth = {
        getStatuses: Ref.get(statuses),
        refresh: Ref.update(refreshes, (count) => count + 1).pipe(
          Effect.andThen(
            probe === "never"
              ? Effect.never
              : Effect.sleep("10 millis").pipe(
                  Effect.andThen(Ref.set(statuses, probe.result)),
                  Effect.as(probe.result),
                ),
          ),
        ),
      } satisfies Pick<ProviderHealthShape, "getStatuses" | "refresh">;
      return { providerHealth, refreshes };
    });
  }

  const proofread = (
    health: Pick<ProviderHealthShape, "getStatuses" | "refresh">,
    cliFound: ProviderCliFound,
    preferences: ReadonlyArray<ModelSelection> = [codexDefault],
  ) =>
    Effect.gen(function* () {
      const read = yield* readProviderHealthForAuxiliaryModel({
        providerHealth: health,
        settings,
        preferences,
        purpose: "text-generation",
        wait: "50 millis",
        cliFound,
      });
      return resolveRunnableModelSelection({
        settings,
        preferences,
        purpose: "text-generation",
        ...read,
      });
    });

  it("proofreads on Claude right after launch when the probe is still running and Codex is not installed", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { providerHealth } = yield* freshHealth("never");
        return yield* proofread(providerHealth, claudeOnlyCli);
      }),
    );
    expect(result).toEqual({
      kind: "fallback",
      selection: {
        provider: "claudeAgent",
        instanceId: "claudeAgent",
        model: DEFAULT_MODEL_BY_PROVIDER.claudeAgent,
      },
    });
  });

  it("uses the probe's result when it finishes within the wait", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { providerHealth } = yield* freshHealth({
          result: [status("codex", "signed-out"), status("claudeAgent")],
        });
        // Both CLIs exist; only the probe knows Codex is signed out.
        return yield* proofread(providerHealth, bothCli);
      }),
    );
    expect(result).toMatchObject({ kind: "fallback", selection: { provider: "claudeAgent" } });
  });

  it("keeps the Codex choice when the probe outlasts the wait but the codex CLI exists", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { providerHealth } = yield* freshHealth("never");
        return yield* proofread(providerHealth, bothCli);
      }),
    );
    expect(result).toEqual({ kind: "selected", preference: 0, selection: codexDefault });
  });

  it("keeps a ready explicit choice and never waits when health is already known", async () => {
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const { providerHealth, refreshes } = yield* freshHealth("never", [
          status("codex"),
          status("claudeAgent"),
        ]);
        const result = yield* proofread(providerHealth, claudeOnlyCli, [claude]);
        return { result, refreshes: yield* Ref.get(refreshes) };
      }),
    );
    expect(outcome).toEqual({
      result: { kind: "selected", preference: 0, selection: claude },
      refreshes: 0,
    });
  });

  it("does not wait when a confirmed ready provider already stands in", async () => {
    const refreshes = await Effect.runPromise(
      Effect.gen(function* () {
        const { providerHealth, refreshes } = yield* freshHealth("never", [
          status("codex", "missing"),
          status("claudeAgent"),
        ]);
        yield* proofread(providerHealth, claudeOnlyCli);
        return yield* Ref.get(refreshes);
      }),
    );
    expect(refreshes).toBe(0);
  });

  it("finds a provider CLI with the same PATH lookup a spawn uses", async () => {
    const bin = await mkdtemp(join(tmpdir(), "provider-cli-"));
    await writeFile(join(bin, "claude"), "#!/bin/sh\n", { mode: 0o755 });
    const path = process.env.PATH;
    process.env.PATH = bin;
    try {
      const instance = (driver: ProviderKind, config: Record<string, unknown> = {}) =>
        ({
          driver,
          instanceId: driver,
          config,
          environment: {},
        }) as unknown as Parameters<ProviderCliFound>[0];
      expect(providerCliFound(instance("claudeAgent"))).toBe(true);
      expect(providerCliFound(instance("codex"))).toBe(false);
      expect(providerCliFound(instance("codex", { binaryPath: join(bin, "claude") }))).toBe(true);
      // No cheap check for other drivers: their missing status stays unknown.
      expect(providerCliFound(instance("cursor"))).toBeUndefined();
    } finally {
      process.env.PATH = path;
      await rm(bin, { recursive: true, force: true });
    }
  });
});

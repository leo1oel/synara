import * as NodeServices from "@effect/platform-node/NodeServices";
import { dirname } from "node:path";
import {
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  type ServerSettings,
  ServerSettingsPatch,
} from "@synara/contracts";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ServerConfig } from "./config";
import {
  gateBetaOnlyProviders,
  resolveTextGenerationProvider,
  ServerSettingsLive,
  ServerSettingsService,
} from "./serverSettings";

const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "synara-settings-test-",
}).pipe(Layer.provide(NodeServices.layer));
const makeTestLayer = Layer.merge(NodeServices.layer, serverConfigLayer);
const testLayer = Layer.merge(makeTestLayer, ServerSettingsLive.pipe(Layer.provide(makeTestLayer)));

const runWithSettings = <A, E>(
  effect: Effect.Effect<A, E, ServerSettingsService | ServerConfig | FileSystem.FileSystem>,
) => Effect.runPromise(effect.pipe(Effect.provide(testLayer)) as Effect.Effect<A, E, never>);

describe("ServerSettingsService", () => {
  it("persists an independent compile repair model across restart", async () => {
    const result = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        const config = yield* ServerConfig;
        yield* service.start;
        const before = yield* service.getSettings;
        yield* service.updateSettings({
          compileRepairModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
        });
        const restarted = yield* Effect.gen(function* () {
          const next = yield* ServerSettingsService;
          yield* next.start;
          return yield* next.getSettings;
        }).pipe(
          Effect.provide(
            ServerSettingsLive.pipe(
              Layer.provide(Layer.merge(NodeServices.layer, Layer.succeed(ServerConfig, config))),
            ),
          ),
        );
        return { before, restarted };
      }),
    );
    expect(result.restarted.compileRepairModelSelection).toEqual({
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
    });
    expect(result.restarted.textGenerationModelSelection).toEqual(
      result.before.textGenerationModelSelection,
    );
  });

  it("loads defaults when settings file does not exist", async () => {
    const settings = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        yield* service.start;
        return yield* service.getSettings;
      }),
    );

    expect(settings.providers.codex.binaryPath).toBe("codex");
    expect(settings.providers.grok.binaryPath).toBe("grok");
    expect(settings.defaultThreadEnvMode).toBe("local");
    expect(settings.enableProviderUpdateChecks).toBe(true);
  });

  it("ignores legacy disabled providers while retaining their custom configuration", async () => {
    const result = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        const config = yield* ServerConfig;
        const { settingsPath } = config;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(dirname(settingsPath), { recursive: true });
        yield* fs.writeFileString(
          settingsPath,
          JSON.stringify({
            revision: 4,
            migrationVersion: 2,
            settings: {
              enableProviderUpdateChecks: false,
              providers: {
                codex: {
                  enabled: false,
                  binaryPath: "/usr/local/bin/codex",
                  customModels: ["gpt-custom"],
                },
              },
            },
          }),
        );
        yield* service.start;
        const updated = yield* service.getSettings;
        const legacyPatch = Schema.decodeUnknownSync(ServerSettingsPatch)({
          providers: { codex: { enabled: false, customModels: ["gpt-custom"] } },
        });
        yield* service.updateSettings(legacyPatch);
        const raw = yield* fs.readFileString(settingsPath);
        const restarted = yield* Effect.gen(function* () {
          const next = yield* ServerSettingsService;
          yield* next.start;
          return yield* next.getSettings;
        }).pipe(
          Effect.provide(
            ServerSettingsLive.pipe(
              Layer.provide(Layer.merge(NodeServices.layer, Layer.succeed(ServerConfig, config))),
            ),
          ),
        );
        return { updated, restarted, legacyPatch, parsed: JSON.parse(raw) as unknown };
      }),
    );

    expect(result.updated.enableProviderUpdateChecks).toBe(false);
    expect(result.updated.providers.codex.enabled).toBe(true);
    expect(result.updated.providers.codex.binaryPath).toBe("/usr/local/bin/codex");
    expect(result.updated.providers.codex.customModels).toEqual(["gpt-custom"]);
    expect(result.legacyPatch.providers?.codex).not.toHaveProperty("enabled");
    expect(result.restarted.providers.codex).toEqual(result.updated.providers.codex);
    expect(result.parsed).toHaveProperty("migrationVersion", 3);
    expect(result.parsed).toHaveProperty("settings.providers.codex.enabled", true);
  });

  it.each([
    [1, "gpt-5.4-mini", DEFAULT_GIT_TEXT_GENERATION_MODEL],
    [2, "gpt-5.6-luna", DEFAULT_GIT_TEXT_GENERATION_MODEL],
    [2, "gpt-5.5", "gpt-5.5"],
    // Lattice already persisted version 3 before 0.9.1; keep those selections.
    [3, "gpt-5.6-luna", "gpt-5.6-luna"],
    [3, "gpt-5.4-mini", "gpt-5.4-mini"],
  ])("updates saved Git writing selection %s/%s", async (migrationVersion, model, expected) => {
    const result = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        const { settingsPath } = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(dirname(settingsPath), { recursive: true });
        yield* fs.writeFileString(
          settingsPath,
          JSON.stringify({
            revision: 7,
            migrationVersion,
            settings: {
              textGenerationModelSelection: {
                provider: "codex",
                model,
              },
            },
          }),
        );

        yield* service.start;
        const settings = yield* service.getSettings;
        const persisted = JSON.parse(yield* fs.readFileString(settingsPath)) as {
          migrationVersion: number;
          settings: { textGenerationModelSelection: { model: string } };
        };
        return { settings, persisted };
      }),
    );

    expect(result.settings.textGenerationModelSelection.model).toBe(expected);
    expect(result.persisted.migrationVersion).toBe(3);
    expect(result.persisted.settings.textGenerationModelSelection.model).toBe(expected);
  });

  it("migrates a removed Kilo text-generation selection to OpenCode", async () => {
    const result = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        const { settingsPath } = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(dirname(settingsPath), { recursive: true });
        yield* fs.writeFileString(
          settingsPath,
          JSON.stringify({
            revision: 3,
            migrationVersion: 2,
            settings: {
              enableProviderUpdateChecks: false,
              textGenerationModelSelection: {
                provider: "kilo",
                model: "kilo/kilo-auto/free",
              },
              providers: {
                kilo: {
                  enabled: true,
                  binaryPath: "/opt/kilo",
                  serverUrl: "http://127.0.0.1:4096",
                  customModels: ["provider/shared-model"],
                },
                opencode: {
                  enabled: false,
                  binaryPath: "/opt/opencode",
                  customModels: ["provider/opencode-model"],
                },
              },
            },
          }),
        );

        yield* service.start;
        const settings = yield* service.getSettings;
        const settingsFileExists = yield* fs.exists(settingsPath);
        return { settings, settingsFileExists };
      }),
    );

    // The rest of the settings and the OpenCode-compatible model survive.
    expect(result.settingsFileExists).toBe(true);
    expect(result.settings.enableProviderUpdateChecks).toBe(false);
    expect(result.settings.textGenerationModelSelection).toMatchObject({
      provider: "opencode",
      model: "kilo/kilo-auto/free",
    });
    expect(result.settings.providers.opencode).toMatchObject({
      binaryPath: "/opt/opencode",
      customModels: ["provider/opencode-model", "provider/shared-model"],
    });
    expect(result.settings.providers.opencode.serverUrl).toBe("");
  });

  it("keeps provider passwords server-only and returns configured flags to clients", async () => {
    const result = await runWithSettings(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        const { settingsPath } = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* service.start;
        const view = yield* service.updateSettingsView({
          providers: {
            opencode: { serverPassword: "opencode-secret" },
          },
        });
        const internal = yield* service.getSettings;
        const persisted = yield* fs.readFileString(settingsPath);
        return { view, internal, persisted };
      }),
    );

    expect(result.internal.providers.opencode.serverPasswordConfigured).toBe(true);
    expect(result.view.providers.opencode).toMatchObject({ serverPasswordConfigured: true });
    expect(JSON.stringify(result.internal)).not.toContain("opencode-secret");
    expect(JSON.stringify(result.view)).not.toContain("opencode-secret");
    expect(JSON.stringify(result.view)).not.toContain('"serverPassword"');
    expect(result.persisted).not.toContain("opencode-secret");
  });

  it.each([
    {
      name: "normalizes enabled but unsupported Git text generation selections",
      overrides: {
        textGenerationModelSelection: {
          provider: "claudeAgent" as const,
          model: DEFAULT_MODEL_BY_PROVIDER.claudeAgent,
        },
      },
      expectedProvider: "codex" as const,
    },
  ])("$name", async ({ overrides, expectedProvider }) => {
    const settings = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ServerSettingsService;
        return yield* service.getSettings;
      }).pipe(Effect.provide(ServerSettingsService.layerTest(overrides))),
    );

    expect(settings.textGenerationModelSelection.provider).toBe(expectedProvider);
    expect(settings.textGenerationModelSelection.model).toBe(
      DEFAULT_MODEL_BY_PROVIDER[expectedProvider],
    );
  });
});

const ompGatedOff = (feature: string) => feature !== "omp";

describe("gateBetaOnlyProviders", () => {
  const withOmpEnabled: ServerSettings = {
    ...DEFAULT_SERVER_SETTINGS,
    providers: {
      ...DEFAULT_SERVER_SETTINGS.providers,
      omp: { ...DEFAULT_SERVER_SETTINGS.providers.omp, enabled: true },
    },
  };

  it("reads a gated-off provider as disabled without touching the others", () => {
    const gated = gateBetaOnlyProviders(withOmpEnabled, ompGatedOff);
    expect(gated.providers.omp.enabled).toBe(false);
    expect(gated.providers.codex.enabled).toBe(true);
    // The input object is untouched — the persisted value survives.
    expect(withOmpEnabled.providers.omp.enabled).toBe(true);
  });

  it("returns the same object when nothing is gated", () => {
    expect(gateBetaOnlyProviders(withOmpEnabled, () => true)).toBe(withOmpEnabled);
  });

  it("leaves an already-disabled provider unchanged", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        omp: { ...DEFAULT_SERVER_SETTINGS.providers.omp, enabled: false },
      },
    };
    expect(gateBetaOnlyProviders(settings, ompGatedOff)).toBe(settings);
  });

  it("falls back to a non-gated provider for text generation", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: { provider: "omp", model: "omp-auto" },
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        omp: { ...DEFAULT_SERVER_SETTINGS.providers.omp, enabled: true },
      },
    };
    const projected = resolveTextGenerationProvider(gateBetaOnlyProviders(settings, ompGatedOff));
    expect(projected.textGenerationModelSelection.provider).not.toBe("omp");
  });
});

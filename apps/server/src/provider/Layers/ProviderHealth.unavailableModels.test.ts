// A model the account refused (a turn failed with model_not_found) travels on the
// instance's provider status as `unavailableModels`, so the picker can grey it out.
// These tests check the projection and the immediate republish, that an automatic
// refresh of the same account keeps the entry (or the model would be offered again
// within seconds), and that a refresh finding another account clears it, except an
// entry recorded after that refresh began.
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { ServerProviderStatus } from "@synara/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Layer, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { afterEach, beforeEach } from "vitest";

import { ServerConfig } from "../../config";
import { ServerSettingsService } from "../../serverSettings";
import {
  recordUnavailableModel,
  resetUnavailableModelsForTest,
} from "../providerModelAvailability.ts";
import { ProviderHealth } from "../Services/ProviderHealth";
import { ProviderHealthLive } from "./ProviderHealth";

const encoder = new TextEncoder();

// What `claude auth status` reports; a test switches it to another account.
let claudeAccount = '{"loggedIn":true,"authMethod":"claude.ai"}';

// Claude answers its probes as a current CLI signed in as `claudeAccount`; every
// other CLI is absent.
const spawnerLayer = Layer.succeed(
  ChildProcessSpawner.ChildProcessSpawner,
  ChildProcessSpawner.make((command) => {
    const { command: binary, args } = command as unknown as {
      command: string;
      args: ReadonlyArray<string>;
    };
    const joined = args.join(" ");
    const result =
      binary === "claude" && joined === "--version"
        ? { stdout: "2.1.296 (Claude Code)\n", code: 0 }
        : binary === "claude" && joined === "auth status"
          ? { stdout: `${claudeAccount}\n`, code: 0 }
          : { stdout: "", code: 127 };
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0x7ff_f_fffd),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: Stream.make(encoder.encode(result.stdout)),
        stderr: Stream.make(encoder.encode("")),
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }),
    );
  }),
);

const claudeOf = (statuses: ReadonlyArray<ServerProviderStatus>) =>
  statuses.find((status) => status.instanceId === "claudeAgent");
const refusedModels = (statuses: ReadonlyArray<ServerProviderStatus>) =>
  claudeOf(statuses)?.unavailableModels?.map((entry) => entry.model);

const reason = "The selected Claude model is unavailable for this account.";

const healthLayer = (baseDir: string) =>
  ProviderHealthLive.pipe(
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
    Layer.provideMerge(spawnerLayer),
    Layer.provideMerge(NodeServices.layer),
  );

it.layer(NodeServices.layer)("ProviderHealth unavailable models", (it) => {
  beforeEach(() => {
    resetUnavailableModelsForTest();
    claudeAccount = '{"loggedIn":true,"authMethod":"claude.ai"}';
  });
  afterEach(() => resetUnavailableModelsForTest());

  it.effect("publishes a refused model at once and keeps it through automatic refreshes", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "provider-health-unavailable-models-",
      });

      yield* Effect.gen(function* () {
        const health = yield* ProviderHealth;
        const probed = claudeOf(yield* health.refresh);
        assert.strictEqual(probed?.status, "ready");
        assert.strictEqual(probed?.unavailableModels, undefined);

        const published = yield* health.streamChanges.pipe(
          Stream.map(claudeOf),
          Stream.filter((status) => status?.unavailableModels !== undefined),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        recordUnavailableModel({ instanceId: "claudeAgent", model: "claude-fable-5-1", reason });

        const pushed = yield* Fiber.join(published);
        assert.strictEqual(pushed._tag, "Some");
        if (pushed._tag === "Some") {
          assert.deepStrictEqual(
            pushed.value?.unavailableModels?.map((entry) => [entry.model, entry.reason]),
            [["claude-fable-5-1", reason]],
          );
          // Projection only: the probe result itself is unchanged.
          assert.strictEqual(pushed.value?.status, "ready");
        }
        assert.deepStrictEqual(refusedModels(yield* health.getStatuses), ["claude-fable-5-1"]);

        // Startup, window focus and the hourly check all land here, with the same account.
        assert.deepStrictEqual(refusedModels(yield* health.refresh), ["claude-fable-5-1"]);
        assert.deepStrictEqual(refusedModels(yield* health.refresh), ["claude-fable-5-1"]);
      }).pipe(Effect.provide(healthLayer(baseDir)));
    }),
  );

  it.effect("forgets the refused models when the refresh finds another account", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "provider-health-unavailable-models-account-",
      });

      yield* Effect.gen(function* () {
        const health = yield* ProviderHealth;
        yield* health.refresh;
        recordUnavailableModel({ instanceId: "claudeAgent", model: "claude-fable-5-1", reason });
        // Stands in for a turn that failed while the next probe was running.
        recordUnavailableModel({
          instanceId: "claudeAgent",
          model: "claude-opus-5",
          reason,
          recordedAt: new Date(Date.now() + 60_000).toISOString(),
        });

        // Signed in with an API key instead of the claude.ai account.
        claudeAccount = '{"loggedIn":true,"authMethod":"api_key"}';
        assert.deepStrictEqual(refusedModels(yield* health.refresh), ["claude-opus-5"]);
      }).pipe(Effect.provide(healthLayer(baseDir)));
    }),
  );

  it.effect("forgets them when the account signs out", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "provider-health-unavailable-models-signout-",
      });

      yield* Effect.gen(function* () {
        const health = yield* ProviderHealth;
        yield* health.refresh;
        recordUnavailableModel({ instanceId: "claudeAgent", model: "claude-fable-5-1", reason });
        claudeAccount = "Not logged in · Please run /login";
        assert.strictEqual(refusedModels(yield* health.refresh), undefined);
      }).pipe(Effect.provide(healthLayer(baseDir)));
    }),
  );
});

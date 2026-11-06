// A model the account refused (a turn failed with model_not_found) travels on the
// instance's provider status as `unavailableModels`, so the picker can grey it out.
// These tests check the projection, the immediate republish, and that a status
// refresh forgets what it re-checked, but not an entry recorded after it began.
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

// Claude answers its probes as a signed-in, current CLI; every other CLI is absent.
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
          ? { stdout: '{"loggedIn":true,"authMethod":"claude.ai"}\n', code: 0 }
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

const reason = "The selected Claude model is unavailable for this account.";

it.layer(NodeServices.layer)("ProviderHealth unavailable models", (it) => {
  beforeEach(() => resetUnavailableModelsForTest());
  afterEach(() => resetUnavailableModelsForTest());

  it.effect("publishes a refused model at once and forgets it on the next refresh", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "provider-health-unavailable-models-",
      });
      const layer = ProviderHealthLive.pipe(
        Layer.provideMerge(ServerSettingsService.layerTest()),
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
        Layer.provideMerge(spawnerLayer),
        Layer.provideMerge(NodeServices.layer),
      );

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
        assert.deepStrictEqual(
          claudeOf(yield* health.getStatuses)?.unavailableModels?.map((entry) => entry.model),
          ["claude-fable-5-1"],
        );

        assert.strictEqual(claudeOf(yield* health.refresh)?.unavailableModels, undefined);
        assert.strictEqual(claudeOf(yield* health.getStatuses)?.unavailableModels, undefined);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("keeps an entry recorded after the refresh began", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "provider-health-unavailable-models-late-",
      });
      const layer = ProviderHealthLive.pipe(
        Layer.provideMerge(ServerSettingsService.layerTest()),
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
        Layer.provideMerge(spawnerLayer),
        Layer.provideMerge(NodeServices.layer),
      );

      yield* Effect.gen(function* () {
        const health = yield* ProviderHealth;
        // Stands in for a turn that failed while the probe was running.
        recordUnavailableModel({
          instanceId: "claudeAgent",
          model: "claude-fable-5-1",
          reason,
          recordedAt: new Date(Date.now() + 60_000).toISOString(),
        });
        recordUnavailableModel({ instanceId: "claude_work", model: "claude-opus-5", reason });

        const refreshed = yield* health.refresh;
        assert.deepStrictEqual(
          claudeOf(refreshed)?.unavailableModels?.map((entry) => entry.model),
          ["claude-fable-5-1"],
        );
      }).pipe(Effect.provide(layer));
    }),
  );
});

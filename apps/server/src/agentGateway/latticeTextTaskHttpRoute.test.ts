import http from "node:http";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type ServerSettings,
} from "@synara/contracts";
import { Deferred, Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it } from "vitest";
import { AuthError, ServerAuth, type ServerAuthShape } from "../auth/Services/ServerAuth.ts";
import { ServerConfig, type ServerConfigShape } from "../config.ts";
import { TextGenerationError } from "../git/Errors.ts";
import {
  TextGeneration,
  type TextGenerationShape,
  type TextTaskGenerationInput,
} from "../git/Services/TextGeneration.ts";
import { ServerSettingsService, type ServerSettingsShape } from "../serverSettings.ts";

import { latticeTextTaskRouteLayer, parseTextTaskInput } from "./latticeTextTaskHttpRoute.ts";

type Outcome = { text: string } | { error: string };

async function withTextTaskServer(
  run: (h: {
    root: string;
    request: (
      path?: string,
      method?: string,
      body?: Record<string, unknown>,
      authenticated?: boolean,
    ) => Promise<Response>;
    calls: TextTaskGenerationInput[];
    /** Settle the next started task; tasks wait until settled or interrupted. */
    settle: (outcome: Outcome) => Promise<void>;
    interrupted: () => number;
  }) => Promise<void>,
  settingsOverrides: Partial<ServerSettings> = {},
) {
  const scope = await Effect.runPromise(Scope.make("sequential"));
  const root = await realpath(await mkdtemp(join(tmpdir(), "text-task-")));
  let server: http.Server | null = null;
  const calls: TextTaskGenerationInput[] = [];
  const pending: Deferred.Deferred<Outcome>[] = [];
  let interrupted = 0;
  const modelSelection = { provider: "claudeAgent" as const, model: "claude-sonnet-4-6" };
  const textGeneration = {
    generateTextTask: (input: TextTaskGenerationInput) =>
      Effect.gen(function* () {
        calls.push(input);
        const outcome = yield* Deferred.make<Outcome>();
        pending.push(outcome);
        const result = yield* Deferred.await(outcome).pipe(
          Effect.onInterrupt(() => Effect.sync(() => interrupted++)),
        );
        if ("error" in result)
          return yield* new TextGenerationError({
            operation: "generateTextTask",
            detail: result.error,
          });
        return result;
      }),
  } as unknown as TextGenerationShape;
  try {
    await Effect.runPromise(
      Scope.provide(
        Effect.gen(function* () {
          const httpServer = yield* NodeHttpServer.make(() => (server = http.createServer()), {
            port: 0,
            host: "127.0.0.1",
          });
          const app = yield* HttpRouter.toHttpEffect(latticeTextTaskRouteLayer);
          yield* httpServer.serve(app);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              NodeServices.layer,
              Layer.succeed(ServerConfig, {
                host: "127.0.0.1",
                authToken: "desktop-token",
              } as ServerConfigShape),
              Layer.succeed(ServerAuth, {
                authenticateHttpRequest: () =>
                  Effect.fail(new AuthError({ message: "Unauthorized", status: 401 })),
              } as unknown as ServerAuthShape),
              Layer.succeed(TextGeneration, textGeneration),
              Layer.succeed(ServerSettingsService, {
                getSettings: Effect.succeed({
                  ...DEFAULT_SERVER_SETTINGS,
                  textGenerationModelSelection: modelSelection,
                  ...settingsOverrides,
                }),
              } as unknown as ServerSettingsShape),
            ),
          ),
        ),
        scope,
      ),
    );
    const address = (server as http.Server | null)?.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    await run({
      root,
      calls,
      interrupted: () => interrupted,
      settle: async (outcome) => {
        const next = pending.shift();
        if (!next) throw new Error("No running task");
        await Effect.runPromise(Deferred.succeed(next, outcome));
      },
      request: (path = "", method = "POST", body, authenticated = true) =>
        fetch(`http://127.0.0.1:${address.port}/api/lattice/text-task${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(authenticated ? { Authorization: "Bearer desktop-token" } : {}),
          },
          ...(method === "POST" && !path
            ? { body: JSON.stringify({ workspaceRoot: root, prompt: "Proofread this.", ...body }) }
            : {}),
        }),
    });
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    await rm(root, { recursive: true, force: true });
  }
}

const gitWritingModel = {
  provider: "claudeAgent",
  instanceId: "claudeAgent",
  slug: "claude-sonnet-4-6",
  label: "Claude / Claude Sonnet 4.6",
  source: "git-writing",
};

async function start(request: (path?: string) => Promise<Response>): Promise<string> {
  const response = await request();
  expect(response.status).toBe(202);
  const { taskId } = (await response.json()) as { taskId: string };
  expect(typeof taskId).toBe("string");
  return taskId;
}

/** Poll until the task leaves `running`; settling is asynchronous to the response. */
async function settled(request: (path?: string, method?: string) => Promise<Response>, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await request(`/${id}`, "GET");
    expect(response.status).toBe(200);
    const status = (await response.json()) as { status: string };
    if (status.status !== "running") return status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Task never settled");
}

describe("Lattice text task HTTP lifecycle", () => {
  it("runs one task with the inherited writing model and answers its final text", async () => {
    await withTextTaskServer(async ({ request, calls, settle, root }) => {
      const started = await request();
      expect(started.status).toBe(202);
      const { taskId: id, model } = (await started.json()) as { taskId: string; model: unknown };
      expect(model).toEqual(gitWritingModel);
      expect(await (await request(`/${id}`, "GET")).json()).toEqual({
        status: "running",
        model: gitWritingModel,
      });
      expect(calls).toEqual([
        {
          cwd: root,
          prompt: "Proofread this.",
          modelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
        },
      ]);

      await settle({ text: "<proofread>Fixed.</proofread>" });
      expect(await settled(request, id)).toEqual({
        status: "completed",
        text: "<proofread>Fixed.</proofread>",
        model: gitWritingModel,
      });
    });
  });

  it("runs on the proofreading model when one is chosen and reports it", async () => {
    await withTextTaskServer(
      async ({ request, calls }) => {
        const id = await start(request);
        expect(calls.map((call) => call.modelSelection)).toEqual([
          { provider: "codex", instanceId: "codex", model: "gpt-5.4" },
        ]);
        expect(await (await request(`/${id}`, "GET")).json()).toEqual({
          status: "running",
          model: {
            provider: "codex",
            instanceId: "codex",
            slug: "gpt-5.4",
            label: "Codex / GPT-5.4",
            source: "proofreading",
          },
        });
      },
      {
        proofreadModelSelection: { provider: "codex", instanceId: "codex", model: "gpt-5.4" },
      } as Partial<ServerSettings>,
    );
  });

  it("falls back to the writing model while the proofreading provider is disabled", async () => {
    await withTextTaskServer(
      async ({ request, calls }) => {
        const id = await start(request);
        expect(calls.map((call) => call.modelSelection)).toEqual([
          { provider: "claudeAgent", model: "claude-sonnet-4-6" },
        ]);
        expect(await (await request(`/${id}`, "GET")).json()).toMatchObject({
          model: { source: "git-writing" },
        });
      },
      {
        proofreadModelSelection: { provider: "codex", model: "gpt-5.4" },
        providers: {
          ...DEFAULT_SERVER_SETTINGS.providers,
          codex: { ...DEFAULT_SERVER_SETTINGS.providers.codex, enabled: false },
        },
      } as Partial<ServerSettings>,
    );
  });

  it("reports a provider failure as a failed task with its detail", async () => {
    await withTextTaskServer(async ({ request, settle }) => {
      const id = await start(request);
      await settle({ error: "Claude CLI command failed: not logged in" });
      expect(await settled(request, id)).toEqual({
        status: "failed",
        message: "Claude CLI command failed: not logged in",
        model: gitWritingModel,
      });
    });
  });

  it("cancels by stopping the provider run before answering", async () => {
    await withTextTaskServer(async ({ request, interrupted }) => {
      const id = await start(request);
      const response = await request(`/${id}/cancel`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: "failed",
        message: "The text task was cancelled.",
        model: gitWritingModel,
      });
      expect(interrupted()).toBe(1);
      expect(await (await request(`/${id}`, "GET")).json()).toMatchObject({ status: "failed" });
      // Cancelling a settled task is a no-op that still answers its status.
      expect(await (await request(`/${id}/cancel`)).json()).toMatchObject({ status: "failed" });
      expect(interrupted()).toBe(1);
    });
  });

  it("answers unknown tasks with JSON so the host never mistakes them for a missing route", async () => {
    await withTextTaskServer(async ({ request }) => {
      for (const [path, method] of [
        ["/missing", "GET"],
        ["/missing/cancel", "POST"],
      ] as const) {
        const response = await request(path, method);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "Unknown text task." });
      }
    });
  });

  it("rejects unauthenticated, invalid, and out-of-workspace requests without running", async () => {
    await withTextTaskServer(async ({ request, calls, root }) => {
      expect((await request("", "POST", {}, false)).status).toBe(401);
      expect((await request("/any", "GET", undefined, false)).status).toBe(401);
      expect((await request("", "POST", { prompt: "  " })).status).toBe(400);
      expect((await request("", "POST", { workspaceRoot: 1 })).status).toBe(400);
      expect(
        (await request("", "POST", { prompt: "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS + 1) }))
          .status,
      ).toBe(400);
      const missing = await request("", "POST", { workspaceRoot: join(root, "missing") });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "Workspace not found." });
      await writeFile(join(root, "main.tex"), "");
      expect((await request("", "POST", { workspaceRoot: join(root, "main.tex") })).status).toBe(
        404,
      );
      expect(calls).toEqual([]);
    });
  });

  it("bounds concurrent tasks and admits new ones as tasks settle", async () => {
    await withTextTaskServer(async ({ request, settle }) => {
      const ids = [];
      for (let index = 0; index < 4; index++) ids.push(await start(request));
      const refused = await request();
      expect(refused.status).toBe(429);
      expect(await refused.json()).toMatchObject({ error: expect.stringContaining("Too many") });

      await settle({ text: "done" });
      await settled(request, ids[0]!);
      await start(request);
    });
  });
});

describe("parseTextTaskInput", () => {
  it("accepts a trimmed workspace and keeps the prompt byte for byte", () => {
    expect(parseTextTaskInput({ workspaceRoot: " /paper ", prompt: "  keep \n" })).toEqual({
      workspaceRoot: "/paper",
      prompt: "  keep \n",
    });
    expect(parseTextTaskInput(null)).toBeNull();
    expect(parseTextTaskInput([])).toBeNull();
    expect(parseTextTaskInput({ workspaceRoot: "", prompt: "x" })).toBeNull();
  });
});

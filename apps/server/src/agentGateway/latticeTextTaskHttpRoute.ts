import { realpath, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@synara/contracts";
import { Cause, Effect, Fiber, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { authErrorResponse } from "../auth/effectHttp.ts";
import { TextGenerationError } from "../git/Errors.ts";
import { TextGeneration } from "../git/Services/TextGeneration.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { readMcpJsonBody } from "./httpRoute.ts";
import { authenticateLatticeRelayRequest } from "./latticeRelayAuthentication.ts";

/**
 * One host-owned request (Lattice proofreading) answered by a single read-only
 * turn: the reply is the answer, and Lattice applies it only after the writer
 * accepts it.
 *
 * Read-only is a property of the turn, not of the prompt. The task runs on the
 * auxiliary text-generation path, which starts every provider with no tools,
 * no MCP servers, no settings sources and an isolated or ask-only workspace,
 * so it cannot edit files or raise an approval whatever the prompt asks. That
 * is also why a text task never creates a thread: there is nothing to approve
 * or review, and proofreading must not fill the task list.
 */
export const LATTICE_TEXT_TASK_PATH = "/api/lattice/text-task";
const MAX_BODY_BYTES = 1024 * 1024;
// Lattice runs one proofread at a time and cancels the previous one, but its
// cancel can trail the next start. Leave room for that overlap, not a backlog.
const MAX_RUNNING_TASKS = 4;
// Settled answers wait for the host's next poll; the host polls every second,
// so anything older belongs to a host that went away.
const SETTLED_TASK_TTL_MS = 10 * 60 * 1000;
const MAX_SETTLED_TASKS = 32;

export type TextTaskStatus =
  | { readonly status: "running" }
  | { readonly status: "completed"; readonly text: string }
  | { readonly status: "failed"; readonly message: string };

type TextTask = {
  status: TextTaskStatus;
  fiber: Fiber.Fiber<void> | null;
  settledAt: number | null;
};

type TextTaskInput = { readonly workspaceRoot: string; readonly prompt: string };

export function parseTextTaskInput(value: unknown): TextTaskInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.workspaceRoot !== "string" ||
    input.workspaceRoot.trim().length === 0 ||
    input.workspaceRoot.length > 4096 ||
    typeof input.prompt !== "string" ||
    input.prompt.trim().length === 0 ||
    input.prompt.length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS
  ) {
    return null;
  }
  return { workspaceRoot: input.workspaceRoot.trim(), prompt: input.prompt };
}

/** Drop settled tasks nobody collected, oldest first, past their TTL or the cap. */
function sweepSettledTasks(tasks: Map<string, TextTask>, now: number): void {
  const settled = [...tasks.entries()]
    .filter(([, task]) => task.settledAt !== null)
    .toSorted(([, a], [, b]) => a.settledAt! - b.settledAt!);
  settled.forEach(([id, task], index) => {
    if (now - task.settledAt! > SETTLED_TASK_TTL_MS || settled.length - index > MAX_SETTLED_TASKS) {
      tasks.delete(id);
    }
  });
}

function taskIdFromRequest(
  request: HttpServerRequest.HttpServerRequest,
  suffix = "",
): string | null {
  const url = HttpServerRequest.toURL(request);
  if (!url) return null;
  const prefix = `${LATTICE_TEXT_TASK_PATH}/`;
  if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith(suffix)) return null;
  const end = suffix.length === 0 ? url.pathname.length : -suffix.length;
  const value = decodeURIComponent(url.pathname.slice(prefix.length, end));
  return value && !value.includes("/") ? value : null;
}

// Every answer is JSON, unknown tasks included: the Lattice relay reads the
// router's bare 404 as "this runtime has no text-task route".
const unknownTask = () =>
  HttpServerResponse.jsonUnsafe({ error: "Unknown text task." }, { status: 404 });

const noStore = { "Cache-Control": "no-store" };

export const latticeTextTaskRouteLayer = Effect.gen(function* () {
  // Running tasks belong to the server, not to the request that started them:
  // closing the server interrupts them, which kills their provider processes.
  const serverScope = yield* Effect.scope;
  const tasks = new Map<string, TextTask>();

  const settle = (id: string, status: Exclude<TextTaskStatus, { status: "running" }>) => {
    const task = tasks.get(id);
    if (!task || task.settledAt !== null) return;
    task.status = status;
    task.fiber = null;
    task.settledAt = Date.now();
  };

  const startTask = HttpRouter.add(
    "POST",
    LATTICE_TEXT_TASK_PATH,
    Effect.gen(function* () {
      yield* authenticateLatticeRelayRequest;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const body = yield* readMcpJsonBody(request, MAX_BODY_BYTES);
      if (body.kind === "too-large")
        return HttpServerResponse.jsonUnsafe(
          { error: "Text task request exceeds 1 MiB." },
          { status: 413 },
        );
      const input = body.kind === "ok" ? parseTextTaskInput(body.body) : null;
      if (!input)
        return HttpServerResponse.jsonUnsafe(
          {
            error: `Invalid text task request. Specify workspaceRoot and a non-empty prompt of at most ${PROVIDER_SEND_TURN_MAX_INPUT_CHARS} characters.`,
          },
          { status: 400 },
        );

      const canonicalRoot = yield* Effect.tryPromise(async () => {
        const root = await realpath(input.workspaceRoot);
        return (await stat(root)).isDirectory() ? root : null;
      }).pipe(Effect.catch(() => Effect.succeed(null)));
      if (!canonicalRoot)
        return HttpServerResponse.jsonUnsafe({ error: "Workspace not found." }, { status: 404 });

      sweepSettledTasks(tasks, Date.now());
      const running = [...tasks.values()].filter((task) => task.settledAt === null).length;
      if (running >= MAX_RUNNING_TASKS)
        return HttpServerResponse.jsonUnsafe(
          { error: "Too many text tasks are running. Try again when one finishes." },
          { status: 429 },
        );

      const settings = yield* ServerSettingsService;
      const textGeneration = yield* TextGeneration;
      return yield* Effect.gen(function* () {
        const modelSelection = (yield* settings.getSettings).textGenerationModelSelection;
        const id = randomUUID();
        tasks.set(id, { status: { status: "running" }, fiber: null, settledAt: null });
        const fiber = yield* textGeneration
          .generateTextTask({ cwd: canonicalRoot, prompt: input.prompt, modelSelection })
          .pipe(
            Effect.matchCause({
              onSuccess: ({ text }) => settle(id, { status: "completed", text }),
              onFailure: (cause) => {
                const error = Cause.squash(cause);
                settle(id, {
                  status: "failed",
                  message:
                    error instanceof TextGenerationError ? error.detail : "The text task failed.",
                });
              },
            }),
            Effect.forkIn(serverScope),
          );
        const task = tasks.get(id);
        if (task && task.settledAt === null) task.fiber = fiber;
        return HttpServerResponse.jsonUnsafe({ taskId: id }, { status: 202, headers: noStore });
      }).pipe(
        Effect.catch(() =>
          Effect.succeed(
            HttpServerResponse.jsonUnsafe(
              { error: "Could not start the text task." },
              { status: 500 },
            ),
          ),
        ),
      );
    }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
  );

  const pollTask = HttpRouter.add(
    "GET",
    `${LATTICE_TEXT_TASK_PATH}/:taskId`,
    Effect.gen(function* () {
      yield* authenticateLatticeRelayRequest;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const id = taskIdFromRequest(request);
      const task = id ? tasks.get(id) : undefined;
      if (!task) return unknownTask();
      return HttpServerResponse.jsonUnsafe(task.status, { headers: noStore });
    }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
  );

  const cancelTask = HttpRouter.add(
    "POST",
    `${LATTICE_TEXT_TASK_PATH}/:taskId/cancel`,
    Effect.gen(function* () {
      yield* authenticateLatticeRelayRequest;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const id = taskIdFromRequest(request, "/cancel");
      const task = id ? tasks.get(id) : undefined;
      if (!id || !task) return unknownTask();
      if (task.fiber) {
        // Interrupting waits for the provider process to be killed, so a
        // cancelled task has stopped by the time this answers.
        yield* Fiber.interrupt(task.fiber);
        settle(id, { status: "failed", message: "The text task was cancelled." });
      }
      return HttpServerResponse.jsonUnsafe(task.status, { headers: noStore });
    }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
  );

  return Layer.mergeAll(startTask, pollTask, cancelTask);
}).pipe(Layer.unwrap);

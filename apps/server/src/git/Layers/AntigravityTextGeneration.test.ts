import * as os from "node:os";
import * as path from "node:path";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, Layer, Result } from "effect";
import { describe, expect, test } from "vitest";

import { TextGeneration } from "../Services/TextGeneration.ts";
import {
  AntigravityTextGenerationLive,
  declineAntigravityPermission,
  resolveAntigravitySettings,
} from "./AntigravityTextGeneration.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockAgentPath = path.join(__dirname, "../../../scripts/acp-mock-agent.ts");

const AntigravityTextGenerationTestLayer = AntigravityTextGenerationLive.pipe(
  Layer.provideMerge(NodeServices.layer),
);

// The mock reports mode and model as config options and offers a Plan mode,
// as `agy acp` does.
const AGY_LIKE_ENV = {
  SYNARA_ACP_CONFIG_OPTION_PICKER: "1",
  SYNARA_ACP_PLAN_MODE: "1",
  SYNARA_ACP_MODE_CONFIG_ID: "execution_mode",
};

/** A line the client wrote to the agent: a request, or its answer to the agent's request. */
interface LoggedRequest {
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function withFakeAgy<A, E, R>(
  env: Record<string, string>,
  effect: (input: {
    readonly agyPath: string;
    readonly readRequests: () => ReadonlyArray<LoggedRequest>;
  }) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const tempDir = mkdtempSync(path.join(os.tmpdir(), "synara-antigravity-text-acp-"));
      const requestLogPath = path.join(tempDir, "requests.ndjson");
      const binDir = path.join(tempDir, "bin");
      const agyPath = path.join(binDir, "agy");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(
        agyPath,
        [
          "#!/bin/sh",
          ...Object.entries({ ...env, SYNARA_ACP_REQUEST_LOG_PATH: requestLogPath }).map(
            ([key, value]) => `export ${key}=${shellSingleQuote(value)}`,
          ),
          'printf "%s\\n" "$NO_BROWSER $AGY_CLI_DISABLE_AUTO_UPDATE" > ' +
            shellSingleQuote(path.join(tempDir, "env.txt")),
          'if [ "$1" != "acp" ] || [ "$#" -ne 1 ]; then',
          '  printf "%s\\n" "unexpected args: $*" >&2',
          "  exit 11",
          "fi",
          `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(mockAgentPath)}`,
          "",
        ].join("\n"),
        "utf8",
      );
      chmodSync(agyPath, 0o755);
      const readRequests = () =>
        readFileSync(requestLogPath, "utf8")
          .trim()
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as LoggedRequest);
      return { tempDir, agyPath, readRequests };
    }),
    ({ agyPath, readRequests }) => effect({ agyPath, readRequests }),
    ({ tempDir }) => Effect.sync(() => rmSync(tempDir, { recursive: true, force: true })),
  );
}

const textTask = (agyPath: string, prompt = "Proofread: Teh cat sat.") =>
  Effect.gen(function* () {
    const textGeneration = yield* TextGeneration;
    return yield* textGeneration.generateTextTask({
      cwd: process.cwd(),
      prompt,
      modelSelection: {
        provider: "antigravity",
        instanceId: "antigravity",
        model: "GPT-5.4",
        options: { reasoningEffort: "high" },
      },
      providerOptions: { antigravity: { binaryPath: agyPath } },
    });
  });

describe("resolveAntigravitySettings", () => {
  test("keeps the instance's binary and environment and turns off updates and browsers", () => {
    expect(
      resolveAntigravitySettings({
        antigravity: { binaryPath: "/opt/agy", environment: { GEMINI_API_KEY: "test-key" } },
      }),
    ).toEqual({
      binaryPath: "/opt/agy",
      environment: {
        GEMINI_API_KEY: "test-key",
        AGY_CLI_DISABLE_AUTO_UPDATE: "true",
        NO_BROWSER: "true",
      },
    });
  });
});

describe("declineAntigravityPermission", () => {
  const toolCall = { toolCallId: "edit-1", title: "Edit main.tex" };

  test("picks the request's reject option", () => {
    expect(
      declineAntigravityPermission({
        sessionId: "s",
        toolCall,
        options: [
          { optionId: "allow", kind: "allow_once", name: "Allow" },
          { optionId: "always", kind: "allow_always", name: "Always" },
          { optionId: "deny", kind: "reject_once", name: "Deny" },
        ],
      }),
    ).toEqual({ outcome: { outcome: "selected", optionId: "deny" } });
  });

  test("cancels a request without a reject option, such as a question", () => {
    expect(
      declineAntigravityPermission({
        sessionId: "s",
        toolCall,
        options: [{ optionId: "yes", kind: "allow_once", name: "Yes" }],
      }),
    ).toEqual({ outcome: { outcome: "cancelled" } });
  });
});

it.layer(AntigravityTextGenerationTestLayer)("AntigravityTextGenerationLive", (it) => {
  it.effect("runs a text task read-only on the chosen model and thinking level", () =>
    withFakeAgy(
      { ...AGY_LIKE_ENV, SYNARA_ACP_PROMPT_RESPONSE_TEXT: "The cat sat." },
      ({ agyPath, readRequests }) =>
        Effect.gen(function* () {
          const result = yield* textTask(agyPath);
          expect(result.text).toBe("The cat sat.");

          const requests = readRequests();
          const initialize = requests.find((request) => request.method === "initialize");
          expect(initialize?.params?.clientCapabilities).toMatchObject({
            fs: { readTextFile: false, writeTextFile: false },
          });
          expect(
            requests.find((request) => request.method === "session/new")?.params?.mcpServers,
          ).toEqual([]);
          expect(requests.some((request) => request.method === "authenticate")).toBe(false);

          const configChanges = requests
            .filter((request) => request.method === "session/set_config_option")
            .map((request) => [request.params?.configId, request.params?.value]);
          expect(configChanges).toEqual([
            ["model", "gpt-5.4"],
            ["reasoning", "high"],
            ["execution_mode", "plan"],
          ]);
          const promptIndex = requests.findIndex((request) => request.method === "session/prompt");
          const planIndex = requests.findIndex(
            (request) =>
              request.method === "session/set_config_option" &&
              request.params?.configId === "execution_mode",
          );
          expect(planIndex).toBeGreaterThan(-1);
          expect(promptIndex).toBeGreaterThan(planIndex);
        }),
    ),
  );

  it.effect("declines the agent's permission requests", () =>
    withFakeAgy(
      { ...AGY_LIKE_ENV, SYNARA_ACP_DEVIN_TASK_REPLAY: "1" },
      ({ agyPath, readRequests }) =>
        Effect.gen(function* () {
          // The mock asks to run a command, offering allow-once and reject-once.
          yield* textTask(agyPath, "root");
          const answers = readRequests().flatMap((line) =>
            line.result && "outcome" in line.result ? [line.result.outcome] : [],
          );
          expect(answers).toEqual([{ outcome: "selected", optionId: "reject-once" }]);
        }),
    ),
  );

  it.effect("refuses to run when the session offers no Plan mode", () =>
    withFakeAgy(
      {
        SYNARA_ACP_CONFIG_OPTION_PICKER: "1",
        SYNARA_ACP_PROMPT_RESPONSE_TEXT: "unused",
      },
      ({ agyPath, readRequests }) =>
        Effect.gen(function* () {
          const result = yield* textTask(agyPath).pipe(Effect.result);
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure.detail).toBe("Antigravity offers no read-only Plan mode.");
          }
          expect(readRequests().some((request) => request.method === "session/prompt")).toBe(false);
        }),
    ),
  );

  it.effect("reports a signed-out agy without starting a sign-in", () =>
    withFakeAgy(
      { ...AGY_LIKE_ENV, SYNARA_ACP_REJECT_UNAUTHENTICATED_SESSION: "1" },
      ({ agyPath, readRequests }) =>
        Effect.gen(function* () {
          const result = yield* textTask(agyPath).pipe(Effect.result);
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(JSON.stringify(result.failure.cause)).toContain("Antigravity is not signed in.");
          }
          const requests = readRequests();
          expect(requests.some((request) => request.method === "authenticate")).toBe(false);
          expect(requests.some((request) => request.method === "session/prompt")).toBe(false);
        }),
    ),
  );
});

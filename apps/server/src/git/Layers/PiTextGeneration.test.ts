import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FS from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import * as OS from "node:os";
import path from "node:path";

import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ServerConfig } from "../../config.ts";
import { PiTextGeneration } from "../Services/TextGeneration.ts";
import { PiTextGenerationServiceLive } from "./PiTextGeneration.ts";

// A fake key: the mock endpoint below is the only thing that ever sees it.
const ENDPOINT_KEY = "sk-test-not-a-real-key";

interface RecordedRequest {
  readonly url: string | undefined;
  readonly model: unknown;
  readonly authorization: string;
  readonly tools: ReadonlyArray<unknown>;
  readonly prompt: string;
}

// Minimal OpenAI-compatible chat-completions endpoint that streams one reply.
async function startMockEndpoint(reply: string) {
  const requests: RecordedRequest[] = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const json = body ? (JSON.parse(body) as Record<string, unknown>) : {};
    const messages = Array.isArray(json.messages)
      ? (json.messages as Array<{ content?: unknown }>)
      : [];
    requests.push({
      url: req.url,
      model: json.model,
      authorization: String(req.headers.authorization ?? ""),
      tools: Array.isArray(json.tools) ? json.tools : [],
      prompt: JSON.stringify(messages.map((message) => message.content)),
    });
    if (req.headers.authorization !== `Bearer ${ENDPOINT_KEY}`) {
      res.writeHead(401).end("bad key");
      return;
    }
    const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
      `data: ${JSON.stringify({
        id: "c1",
        object: "chat.completion.chunk",
        created: 0,
        model: "endpoint-model",
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(chunk({ role: "assistant", content: reply }));
    res.write(chunk({}, "stop"));
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    requests,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("PiTextGeneration", () => {
  let scratch: string;
  let endpoint: Awaited<ReturnType<typeof startMockEndpoint>> | undefined;

  beforeEach(async () => {
    scratch = await FS.mkdtemp(path.join(OS.tmpdir(), "synara-pi-text-test-"));
  });

  afterEach(async () => {
    await endpoint?.close();
    endpoint = undefined;
    await FS.rm(scratch, { recursive: true, force: true });
  });

  // Mirrors a Lattice "Model endpoint" setup: a Pi instance whose agent dir
  // holds only a models.json custom provider, with the key in the instance
  // environment. No Pi CLI, no auth.json, no ~/.pi.
  async function writeEndpointConfig(baseUrl: string) {
    const agentDir = path.join(scratch, "agent");
    await FS.mkdir(agentDir, { recursive: true });
    await FS.writeFile(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          endpoint: {
            api: "openai-completions",
            baseUrl,
            apiKey: "$ENDPOINT_KEY",
            models: [{ id: "endpoint-model", contextWindow: 128_000, maxTokens: 8_192 }],
          },
        },
      }),
    );
    return agentDir;
  }

  const runWithPi = <A, E>(effect: Effect.Effect<A, E, PiTextGeneration>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(
          PiTextGenerationServiceLive.pipe(
            Layer.provide(
              ServerConfig.layerTest(process.cwd(), path.join(scratch, "server")).pipe(
                Layer.provide(NodeServices.layer),
              ),
            ),
          ),
        ),
      ) as Effect.Effect<A, E, never>,
    );

  it("answers a Proofread-style text task on a custom endpoint with no tools", async () => {
    endpoint = await startMockEndpoint('{"text":"We report the results."}');
    const agentDir = await writeEndpointConfig(endpoint.baseUrl);

    const result = await runWithPi(
      Effect.gen(function* () {
        const pi = yield* PiTextGeneration;
        return yield* pi.generateTextTask({
          cwd: scratch,
          prompt: "Proofread: We report teh results.",
          modelSelection: {
            provider: "pi",
            instanceId: "pi_endpoint",
            model: "endpoint/endpoint-model",
          },
          providerOptions: {
            pi: { agentDir, environment: { ENDPOINT_KEY } },
          },
        });
      }),
    );

    expect(result.text).toBe("We report the results.");
    expect(endpoint.requests).toHaveLength(1);
    const [request] = endpoint.requests;
    expect(request?.url).toBe("/v1/chat/completions");
    expect(request?.model).toBe("endpoint-model");
    expect(request?.authorization).toBe(`Bearer ${ENDPOINT_KEY}`);
    // The writing session must never offer the model tools.
    expect(request?.tools).toEqual([]);
    expect(request?.prompt).toContain("Proofread: We report teh results.");
  });

  it("accepts a plain-text reply for a text task", async () => {
    endpoint = await startMockEndpoint("We report the results.");
    const agentDir = await writeEndpointConfig(endpoint.baseUrl);

    const result = await runWithPi(
      Effect.gen(function* () {
        const pi = yield* PiTextGeneration;
        return yield* pi.generateTextTask({
          cwd: scratch,
          prompt: "Proofread: We report teh results.",
          modelSelection: { provider: "pi", instanceId: "pi_endpoint", model: "endpoint-model" },
          providerOptions: { pi: { agentDir, environment: { ENDPOINT_KEY } } },
        });
      }),
    );

    expect(result.text).toBe("We report the results.");
  });

  it("reports the endpoint's error instead of returning empty text", async () => {
    endpoint = await startMockEndpoint('{"text":"unused"}');
    const agentDir = await writeEndpointConfig(endpoint.baseUrl);

    const error = await runWithPi(
      Effect.gen(function* () {
        const pi = yield* PiTextGeneration;
        return yield* pi
          .generateTextTask({
            cwd: scratch,
            prompt: "Proofread this.",
            modelSelection: { provider: "pi", instanceId: "pi_endpoint", model: "endpoint-model" },
            providerOptions: {
              pi: { agentDir, environment: { ENDPOINT_KEY: "sk-wrong-key" } },
            },
          })
          .pipe(Effect.flip);
      }),
    );

    expect(error._tag).toBe("TextGenerationError");
    expect(error.operation).toBe("generateTextTask");
    expect(error.detail).toMatch(/^Pi request failed/);
  });

  it("fails clearly when the selected Pi model is not configured", async () => {
    endpoint = await startMockEndpoint('{"text":"unused"}');
    const agentDir = await writeEndpointConfig(endpoint.baseUrl);

    const error = await runWithPi(
      Effect.gen(function* () {
        const pi = yield* PiTextGeneration;
        return yield* pi
          .generateTextTask({
            cwd: scratch,
            prompt: "Proofread this.",
            modelSelection: { provider: "pi", instanceId: "pi_endpoint", model: "missing-model" },
            providerOptions: { pi: { agentDir, environment: { ENDPOINT_KEY } } },
          })
          .pipe(Effect.flip);
      }),
    );

    expect(error.detail).toContain("Pi model 'missing-model' is not available");
    expect(endpoint.requests).toHaveLength(0);
  });
});

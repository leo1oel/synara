import * as fs from "node:fs";
import * as path from "node:path";

import { Layer, Effect, Stream } from "effect";

import { ServerConfig } from "../../config.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import {
  ensurePrivateDirectorySync,
  ensurePrivateFileSync,
  PRIVATE_FILE_MODE,
} from "../../privatePathPermissions.ts";
import {
  createAgentQualityTraceProjector,
  type AgentQualityTraceRecord,
} from "../agentQualityTrace.ts";
import { AgentQualityTrace, type AgentQualityTraceShape } from "../Services/AgentQualityTrace.ts";

const TRACE_FILE_NAME = "agent-quality.ndjson";
const MAX_TRACE_BYTES = 10 * 1024 * 1024;
const MAX_TRACE_FILES = 3;

export function createPrivateRotatingWriter(traceDir: string) {
  const tracePath = path.join(traceDir, TRACE_FILE_NAME);
  const ensurePrivatePath = () => {
    ensurePrivateDirectorySync(traceDir);
    ensurePrivateFileSync(tracePath);
  };
  const rotate = (incomingBytes: number) => {
    if (!fs.existsSync(tracePath)) return;
    if (fs.statSync(tracePath).size + incomingBytes <= MAX_TRACE_BYTES) return;
    const oldest = `${tracePath}.${MAX_TRACE_FILES - 1}`;
    if (fs.existsSync(oldest)) fs.rmSync(oldest);
    // Releases before the retention count included the active file could
    // leave one extra generation behind. Remove it while rotating so the
    // tighter active-plus-backups limit also applies after an upgrade.
    const legacyOldest = `${tracePath}.${MAX_TRACE_FILES}`;
    if (fs.existsSync(legacyOldest)) fs.rmSync(legacyOldest);
    for (let index = MAX_TRACE_FILES - 2; index >= 1; index -= 1) {
      const source = `${tracePath}.${index}`;
      if (fs.existsSync(source)) fs.renameSync(source, `${tracePath}.${index + 1}`);
    }
    fs.renameSync(tracePath, `${tracePath}.1`);
  };

  return (records: readonly AgentQualityTraceRecord[]): void => {
    if (records.length === 0) return;
    const lines = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
    const bytes = Buffer.byteLength(lines);
    rotate(bytes);
    ensurePrivatePath();
    fs.appendFileSync(tracePath, lines, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  };
}

export const AgentQualityTraceLayer = Layer.effect(
  AgentQualityTrace,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const providerService = yield* ProviderService;
    const projector = createAgentQualityTraceProjector();
    const write = createPrivateRotatingWriter(path.join(config.logsDir, "agent-quality"));
    const writeRecords = (records: readonly AgentQualityTraceRecord[]) =>
      Effect.try({
        try: () => write(records),
        catch: (cause) => cause,
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Agent quality trace write failed", {
            causeType: cause instanceof Error ? cause.name : typeof cause,
          }),
        ),
      );

    const start: AgentQualityTraceShape["start"] = Effect.gen(function* () {
      yield* Effect.forkScoped(
        Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
          writeRecords(projector.projectDomainEvent(event)),
        ),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(providerService.streamEvents, (event) =>
          writeRecords(projector.projectRuntimeEvent(event)),
        ),
      );
    });

    return {
      start,
      prepareTurnContext: (input) => Effect.sync(() => projector.prepareTurnContext(input)),
      failTurnContext: (input) =>
        Effect.sync(() =>
          projector.failTurnContext({
            ...input,
            failedAt: new Date().toISOString(),
          }),
        ),
      recordCompile: (result) => writeRecords([projector.projectCompileResult(result)]),
    } satisfies AgentQualityTraceShape;
  }),
);

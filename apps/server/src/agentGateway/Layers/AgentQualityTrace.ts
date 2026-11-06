import * as path from "node:path";

import { RotatingFileSink } from "@synara/shared/logging";
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
// Rotated generations kept beside the active file.
const MAX_TRACE_BACKUPS = 2;

export function createPrivateRotatingWriter(traceDir: string) {
  const tracePath = path.join(traceDir, TRACE_FILE_NAME);
  let sink: RotatingFileSink | null = null;

  return (records: readonly AgentQualityTraceRecord[]): void => {
    if (records.length === 0) return;
    const lines = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
    ensurePrivateDirectorySync(traceDir);
    ensurePrivateFileSync(tracePath);
    // Opened on the first record. Opening prunes generations beyond the retention
    // count, including the extra one releases that counted the active file as a
    // backup could leave behind.
    sink ??= new RotatingFileSink({
      filePath: tracePath,
      maxBytes: MAX_TRACE_BYTES,
      maxFiles: MAX_TRACE_BACKUPS,
      mode: PRIVATE_FILE_MODE,
      throwOnError: true,
    });
    sink.write(lines);
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
      prepareTurnContext: (input) => writeRecords(projector.prepareTurnContext(input)),
      bindTurnContext: (input) => writeRecords(projector.bindTurnContext(input)),
      failTurnContext: (input) =>
        writeRecords(
          projector.failTurnContext({
            ...input,
            failedAt: new Date().toISOString(),
          }),
        ),
      recordCompile: (result) => writeRecords([projector.projectCompileResult(result)]),
    } satisfies AgentQualityTraceShape;
  }),
);

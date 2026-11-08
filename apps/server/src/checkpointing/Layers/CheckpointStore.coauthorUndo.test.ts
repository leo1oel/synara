// FILE: CheckpointStore.coauthorUndo.test.ts
// Purpose: Pins what file Undo does to edits that are not the agent's, with the
//          real store and real git: a co-author's text synced from Overleaf, or
//          the user's own typing, landing after the turn's snapshot.
// Layer: Checkpointing tests.
// Scenarios follow Lattice's undo investigation: S0 nobody else edits, S1 the
// next paragraph, S2 the agent's own sentence, S3 a distant line.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { CheckpointRef, ThreadId, TurnId } from "@synara/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { ServerConfig } from "../../config.ts";
import { GitCoreLive } from "../../git/Layers/GitCore.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import { checkpointRefForThreadTurnHostWrites } from "../Utils.ts";
import { CheckpointStoreLive } from "./CheckpointStore.ts";

const BASE = [
  "\\section{Intro}",
  "",
  "P: The old opening paragraph says one thing.",
  "",
  "Q: The second paragraph stays as written.",
  "",
  "End.",
  "",
].join("\n");
const AGENT_P = "P: The agent rewrote the opening paragraph completely.";
const agentText = BASE.replace("P: The old opening paragraph says one thing.", AGENT_P);

const startRef = CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/turn-start/t1");
const endRef = CheckpointRef.makeUnsafe("refs/synara-checkpoints/thread/turn/1");

describe("CheckpointStoreLive file Undo keeps edits that are not the agent's", () => {
  const cwds: string[] = [];
  let runtime: ManagedRuntime.ManagedRuntime<CheckpointStore, unknown> | null = null;

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
    for (const cwd of cwds.splice(0)) rmSync(cwd, { recursive: true, force: true });
  });

  const workspace = () => {
    const cwd = mkdtempSync(join(tmpdir(), "synara-coauthor-undo-"));
    cwds.push(cwd);
    const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
    git("init", "--initial-branch=main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test User");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(cwd, "main.tex"), BASE);
    writeFileSync(join(cwd, "other.tex"), "Other file, as before.\n");
    git("add", ".");
    git("commit", "-m", "Initial");
    runtime = ManagedRuntime.make(
      CheckpointStoreLive.pipe(
        Layer.provide(
          GitCoreLive.pipe(
            Layer.provide(ServerConfig.layerTest(cwd, { prefix: "synara-coauthor-undo-" })),
          ),
        ),
        Layer.provide(NodeServices.layer),
      ),
    );
    return { cwd, git, read: (file: string) => readFileSync(join(cwd, file), "utf8") };
  };

  /** Snapshot, let the agent rewrite P, snapshot, then apply `after` and undo. */
  const agentTurnThenUndo = (cwd: string, after: () => void) =>
    runtime!.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        yield* store.captureCheckpoint({ cwd, checkpointRef: startRef });
        writeFileSync(join(cwd, "main.tex"), agentText);
        yield* store.captureCheckpoint({ cwd, checkpointRef: endRef });
        after();
        return yield* store.reverseCheckpointDiff({
          cwd,
          fromCheckpointRef: startRef,
          toCheckpointRef: endRef,
        });
      }),
    );

  it("S0: with no other edits, Undo puts the original text back", async () => {
    const { cwd, read } = workspace();
    const result = await agentTurnThenUndo(cwd, () => undefined);
    expect(result).toEqual({ conflictedPaths: [] });
    expect(read("main.tex")).toBe(BASE);
  });

  it("S1: keeps a co-author's edit to the next paragraph", async () => {
    const { cwd, read } = workspace();
    const coauthor = "Q: The second paragraph stays as written, with a co-author clause.";
    const result = await agentTurnThenUndo(cwd, () =>
      writeFileSync(
        join(cwd, "main.tex"),
        agentText.replace("Q: The second paragraph stays as written.", coauthor),
      ),
    );
    expect(result).toEqual({ conflictedPaths: [] });
    expect(read("main.tex")).toBe(
      BASE.replace("Q: The second paragraph stays as written.", coauthor),
    );
  });

  it("S3: keeps a co-author's edit to a distant line and to another file", async () => {
    const { cwd, read } = workspace();
    const result = await agentTurnThenUndo(cwd, () => {
      writeFileSync(join(cwd, "main.tex"), agentText.replace("End.", "End. Co-author footnote."));
      writeFileSync(join(cwd, "other.tex"), "Other file, edited by a co-author.\n");
    });
    expect(result).toEqual({ conflictedPaths: [] });
    expect(read("main.tex")).toBe(BASE.replace("End.", "End. Co-author footnote."));
    expect(read("other.tex")).toBe("Other file, edited by a co-author.\n");
  });

  it("S2: marks only the overlapping spot as a conflict and undoes the rest", async () => {
    const { cwd, git, read } = workspace();
    const coauthorP = `${AGENT_P} Co-author sentence.`;
    const coauthorQ = "Q: The second paragraph stays as written, with a co-author clause.";
    // A second agent hunk far from the conflict, so the test can see that the
    // clean part of the undo still lands.
    const result = await runtime!.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        yield* store.captureCheckpoint({ cwd, checkpointRef: startRef });
        writeFileSync(join(cwd, "main.tex"), agentText);
        writeFileSync(join(cwd, "other.tex"), "Other file, rewritten by the agent.\n");
        yield* store.captureCheckpoint({ cwd, checkpointRef: endRef });
        writeFileSync(
          join(cwd, "main.tex"),
          agentText.replace(AGENT_P, coauthorP).replace(
            "Q: The second paragraph stays as written.",
            coauthorQ,
          ),
        );
        return yield* store.reverseCheckpointDiff({
          cwd,
          fromCheckpointRef: startRef,
          toCheckpointRef: endRef,
        });
      }),
    );

    expect(result).toEqual({ conflictedPaths: ["main.tex"] });
    expect(read("other.tex")).toBe("Other file, as before.\n");
    // diff3 markers around the agent's sentence only: ours is the text now on
    // disk, base the agent's version, theirs the text before the agent.
    expect(read("main.tex")).toBe(
      [
        "\\section{Intro}",
        "",
        "<<<<<<< ours",
        coauthorP,
        "||||||| base",
        AGENT_P,
        "=======",
        "P: The old opening paragraph says one thing.",
        ">>>>>>> theirs",
        "",
        coauthorQ,
        "",
        "End.",
        "",
      ].join("\n"),
    );
    // The repository index never sees an unmerged entry.
    expect(git("ls-files", "--unmerged")).toBe("");
  });

  it("still refuses, and changes nothing, when the file was deleted since", async () => {
    const { cwd, read } = workspace();
    await expect(
      agentTurnThenUndo(cwd, () => rmSync(join(cwd, "main.tex"))),
    ).rejects.toThrow(/workspace changed since this checkpoint/);
    expect(() => read("main.tex")).toThrow();
    expect(read("other.tex")).toBe("Other file, as before.\n");
  });

  it("records and reads the files the host wrote during a turn", async () => {
    const { cwd } = workspace();
    const ref = checkpointRefForThreadTurnHostWrites(
      ThreadId.makeUnsafe("thread-1"),
      TurnId.makeUnsafe("turn-1"),
    );
    const written = await runtime!.runPromise(
      Effect.gen(function* () {
        const store = yield* CheckpointStore;
        const before = yield* store.readHostWrites({ cwd, ref });
        yield* store.recordHostWrites({ cwd, ref, paths: ["main.tex"] });
        yield* store.recordHostWrites({ cwd, ref, paths: ["other.tex", "main.tex"] });
        return { before, after: yield* store.readHostWrites({ cwd, ref }) };
      }),
    );
    expect(written).toEqual({ before: [], after: ["main.tex", "other.tex"] });
  });
});

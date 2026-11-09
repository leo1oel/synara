// FILE: GitCore.scratchObjects.test.ts
// Purpose: Proves read-only status and commit previews never write objects into the repository,
//          even when Git is killed mid-pack (Lattice issue #738).
// Layer: Server Git service tests
// Depends on: real Git in temporary repositories.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { describe, expect } from "vitest";
import { TestClock } from "effect/testing";

import { GitCoreLive, makeGitCore } from "./GitCore.ts";
import { GitCore, type ExecuteGitInput, type GitCoreShape } from "../Services/GitCore.ts";
import { GitCommandError } from "../Errors.ts";
import { ServerConfig } from "../../config.ts";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "synara-git-scratch-objects-test-",
});
const TestLayer = Layer.mergeAll(
  NodeServices.layer,
  GitCoreLive.pipe(Layer.provide(ServerConfigLayer), Layer.provide(NodeServices.layer)),
);

const ADD_OPERATION = "GitCore.statusDetails.moveAwareAddAll";
const MIB = 1024 * 1024;

const makeTmpDir = () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.makeTempDirectoryScoped({ prefix: "git-scratch-objects-" });
  });

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const result = yield* (yield* GitCore).execute({
      operation: "GitCore.scratchObjects.test.git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });

const makeCore = (
  executeOverride: GitCoreShape["execute"],
  moveAwareStatusLimits?: NonNullable<Parameters<typeof makeGitCore>[0]>["moveAwareStatusLimits"],
) =>
  makeGitCore({
    executeOverride,
    ...(moveAwareStatusLimits ? { moveAwareStatusLimits } : {}),
  }).pipe(Effect.provide(Layer.provideMerge(ServerConfigLayer, NodeServices.layer)));

// Every file under the repository's object database, with its size: loose
// objects, packs, and any `tmp_pack_*`/`tmp_obj_*` a killed Git leaves behind.
async function objectDatabaseSnapshot(repo: string): Promise<string[]> {
  const root = path.join(repo, ".git", "objects");
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(entry.parentPath, entry.name);
    files.push(`${path.relative(root, filePath)}:${(await fs.stat(filePath)).size}`);
  }
  return files.toSorted();
}

const snapshot = (repo: string) => Effect.promise(() => objectDatabaseSnapshot(repo));

/**
 * A repository whose status takes the rename-aware path: a tracked file moved
 * into an untracked directory, beside whatever else the test puts there.
 */
const makeMovedFileRepo = (extraUntracked: Record<string, Buffer | string> = {}) =>
  Effect.gen(function* () {
    const repo = yield* makeTmpDir();
    yield* git(repo, ["init", "--quiet"]);
    yield* git(repo, ["config", "user.email", "test@test.com"]);
    yield* git(repo, ["config", "user.name", "Test"]);
    // Git cannot stream a file into a pack while an end-of-line conversion
    // applies, so keep a global core.autocrlf from hiding the tmp_pack path.
    yield* git(repo, ["config", "core.autocrlf", "false"]);
    const contents = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n");
    yield* Effect.promise(() => fs.writeFile(path.join(repo, "chapter.tex"), `${contents}\n`));
    yield* git(repo, ["add", "."]);
    yield* git(repo, ["commit", "--quiet", "-m", "initial"]);
    yield* Effect.promise(async () => {
      await fs.mkdir(path.join(repo, "sections"), { recursive: true });
      await fs.rm(path.join(repo, "chapter.tex"));
      await fs.writeFile(
        path.join(repo, "sections", "chapter.tex"),
        `${contents}\nnew closing line\n`,
      );
      for (const [relativePath, data] of Object.entries(extraUntracked)) {
        await fs.mkdir(path.dirname(path.join(repo, relativePath)), { recursive: true });
        await fs.writeFile(path.join(repo, relativePath), data);
      }
    });
    return repo;
  });

const scratchDirectoryOf = (input: ExecuteGitInput) => {
  const objectDirectory = input.env?.GIT_OBJECT_DIRECTORY;
  expect(objectDirectory, "the add must name a scratch object directory").toBeTruthy();
  return path.dirname(objectDirectory!);
};

it.layer(TestLayer)("GitCore scratch object store", (it) => {
  describe("rename-aware status", () => {
    it.effect("summarizes a move without writing an object into the repository", () =>
      Effect.gen(function* () {
        const realCore = yield* GitCore;
        const repo = yield* makeMovedFileRepo({ "sections/notes.txt": "one\ntwo\n" });
        const before = yield* snapshot(repo);
        const indexBefore = yield* Effect.promise(() => fs.readFile(path.join(repo, ".git/index")));
        const adds: ExecuteGitInput[] = [];
        const core = yield* makeCore((input) => {
          if (input.operation === ADD_OPERATION) adds.push(input);
          return realCore.execute(input);
        });

        const details = yield* core.statusDetails(repo);

        expect(details.workingTree.files).toEqual([
          { path: "sections/chapter.tex", insertions: 1, deletions: 0 },
          { path: "sections/notes.txt", insertions: 2, deletions: 0 },
        ]);
        expect(adds).toHaveLength(1);
        const scratch = scratchDirectoryOf(adds[0]!);
        expect(scratch.startsWith(repo)).toBe(false);
        const alternate = adds[0]!.env?.GIT_ALTERNATE_OBJECT_DIRECTORIES ?? "";
        expect(yield* Effect.promise(() => fs.realpath(alternate))).toBe(
          yield* Effect.promise(() => fs.realpath(path.join(repo, ".git", "objects"))),
        );
        expect(existsSync(scratch)).toBe(false);
        expect(yield* snapshot(repo)).toEqual(before);
        expect(yield* Effect.promise(() => fs.readFile(path.join(repo, ".git/index")))).toEqual(
          indexBefore,
        );
      }),
    );

    // The reporter's control: Git streams a file above core.bigFileThreshold into
    // a tmp_pack, is killed while writing it, and leaves the pack behind.
    it.effect("leaves no temporary pack when the add is killed while writing one", () =>
      TestClock.withLive(
        Effect.gen(function* () {
          const realCore = yield* GitCore;
          const repo = yield* makeMovedFileRepo({ "results/run.bin": randomBytes(32 * MIB) });
          yield* git(repo, ["config", "core.bigFileThreshold", "64k"]);
          const before = yield* snapshot(repo);
          let scratch: string | undefined;
          let sawTmpPack = false;
          const core = yield* makeCore(
            (input) => {
              if (input.operation !== ADD_OPERATION) return realCore.execute(input);
              scratch = scratchDirectoryOf(input);
              const packDirectory = path.join(input.env!.GIT_OBJECT_DIRECTORY!, "pack");
              // Interrupt exactly as `execute`'s timeout does, once Git is mid-pack.
              const tmpPackStarted = Effect.promise(async () => {
                const deadline = Date.now() + 10_000;
                while (Date.now() < deadline) {
                  const names = await fs.readdir(packDirectory).catch(() => [] as string[]);
                  if (names.some((name) => name.startsWith("tmp_pack_"))) {
                    sawTmpPack = true;
                    return;
                  }
                  await new Promise((resolve) => setTimeout(resolve, 1));
                }
              }).pipe(
                Effect.andThen(
                  Effect.fail(
                    new GitCommandError({
                      operation: input.operation,
                      command: "git add",
                      cwd: input.cwd,
                      detail: "git add timed out.",
                    }),
                  ),
                ),
              );
              return Effect.raceFirst(
                realCore.execute({ ...input, timeoutMs: null }),
                tmpPackStarted,
              );
            },
            { largeFileBytes: 1024 * MIB, hashBudgetBytes: 1024 * MIB },
          );

          const details = yield* core.statusDetails(repo);

          expect(sawTmpPack).toBe(true);
          expect(details.hasWorkingTreeChanges).toBe(true);
          expect(existsSync(scratch!)).toBe(false);
          // A surviving Git could still be writing; give it time to show up.
          yield* Effect.sleep("200 millis");
          expect(existsSync(scratch!)).toBe(false);
          expect(yield* snapshot(repo)).toEqual(before);
        }),
      ),
    );

    // A live clock, so the add's timeout really fires.
    it.effect("kills a timed-out add and removes its scratch store", () =>
      TestClock.withLive(
        Effect.gen(function* () {
          const realCore = yield* GitCore;
          const repo = yield* makeMovedFileRepo({ "results/run.bin": randomBytes(32 * MIB) });
          yield* git(repo, ["config", "core.bigFileThreshold", "64k"]);
          const before = yield* snapshot(repo);
          let scratch: string | undefined;
          let addFailure: string | undefined;
          const core = yield* makeCore(
            (input) => {
              // The lowered limit is for the add; a loaded machine must not
              // time out the untracked listing before the add even starts.
              if (input.operation !== ADD_OPERATION) {
                return realCore.execute({ ...input, timeoutMs: 30_000 });
              }
              scratch = scratchDirectoryOf(input);
              return realCore.execute(input).pipe(
                Effect.tapError((error) =>
                  Effect.sync(() => {
                    addFailure = error.detail;
                  }),
                ),
              );
            },
            { timeoutMs: 20, largeFileBytes: 1024 * MIB, hashBudgetBytes: 1024 * MIB },
          );

          yield* core.statusDetails(repo);

          expect(addFailure).toContain("timed out");
          expect(existsSync(scratch!)).toBe(false);
          yield* Effect.sleep("200 millis");
          expect(existsSync(scratch!)).toBe(false);
          expect(yield* snapshot(repo)).toEqual(before);
        }),
      ),
    );

    it.effect("counts a large untracked file as binary without hashing it", () =>
      Effect.gen(function* () {
        const realCore = yield* GitCore;
        const repo = yield* makeMovedFileRepo({ "sections/data.bin": randomBytes(4096) });
        const before = yield* snapshot(repo);
        const pathspecs: string[] = [];
        const core = yield* makeCore(
          (input) =>
            Effect.gen(function* () {
              if (input.operation === ADD_OPERATION) {
                const fileArgument = input.args.find((arg) =>
                  arg.startsWith("--pathspec-from-file="),
                );
                const contents = yield* Effect.promise(() =>
                  fs.readFile(fileArgument!.slice("--pathspec-from-file=".length), "utf8"),
                );
                pathspecs.push(...contents.split("\0").filter(Boolean));
              }
              return yield* realCore.execute(input);
            }),
          { largeFileBytes: 1024 },
        );

        const details = yield* core.statusDetails(repo);

        expect(pathspecs).toEqual([":/", ":(top,exclude,literal)sections/data.bin"]);
        expect(details.workingTree.files).toEqual([
          { path: "sections/chapter.tex", insertions: 1, deletions: 0 },
          { path: "sections/data.bin", insertions: 0, deletions: 0 },
        ]);
        expect(yield* snapshot(repo)).toEqual(before);
      }),
    );

    it.effect("skips hashing entirely when untracked files exceed the budget", () =>
      Effect.gen(function* () {
        const realCore = yield* GitCore;
        const repo = yield* makeMovedFileRepo({ "sections/data.bin": randomBytes(4096) });
        const before = yield* snapshot(repo);
        const operations: string[] = [];
        const core = yield* makeCore(
          (input) => {
            operations.push(input.operation);
            return realCore.execute(input);
          },
          { hashBudgetBytes: 1024 },
        );

        const details = yield* core.statusDetails(repo);

        expect(details.hasWorkingTreeChanges).toBe(true);
        expect(operations).toContain("GitCore.statusDetails.moveAwareUntracked");
        expect(operations).not.toContain(ADD_OPERATION);
        expect(yield* snapshot(repo)).toEqual(before);
      }),
    );
  });

  describe("commit message preview", () => {
    it.effect("previews staged changes without writing an object into the repository", () =>
      Effect.gen(function* () {
        const core = yield* GitCore;
        const repo = yield* makeMovedFileRepo({ "sections/notes.txt": "one\ntwo\n" });
        const before = yield* snapshot(repo);
        const indexBefore = yield* Effect.promise(() => fs.readFile(path.join(repo, ".git/index")));

        const preview = yield* core.previewCommitContext(repo);

        expect(preview?.stagedSummary).toContain("sections/notes.txt");
        expect(preview?.stagedPatch).toContain("+new closing line");
        expect(yield* snapshot(repo)).toEqual(before);
        expect(yield* Effect.promise(() => fs.readFile(path.join(repo, ".git/index")))).toEqual(
          indexBefore,
        );
      }),
    );
  });
});

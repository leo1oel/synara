import { ProjectId, ThreadId, TurnId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  HOST_WRITE_TURN_END_SLACK_MS,
  LATTICE_HOST_FILE_WRITES,
  attributeHostWrites,
  parseLatticeHostFileWrites,
} from "./latticeHostWrites.ts";

const at = (ms: number) => new Date(Date.UTC(2026, 10, 8, 12, 0, 0) + ms).toISOString();
const report = (writes: Array<{ path: string; writtenAt: string }>, workspaceRoot = "/paper") => ({
  type: LATTICE_HOST_FILE_WRITES,
  version: 1,
  workspaceRoot,
  writes,
});

describe("parseLatticeHostFileWrites", () => {
  it("accepts workspace-relative paths with timestamps", () => {
    expect(
      parseLatticeHostFileWrites(report([{ path: "sec/main.tex", writtenAt: at(0) }])),
    ).toEqual({
      workspaceRoot: "/paper",
      writes: [{ path: "sec/main.tex", writtenAt: Date.parse(at(0)) }],
    });
  });

  it.each(["/etc/passwd", "../outside.tex", "a/../b.tex", "a//b.tex", "C:/x.tex", "a\\b.tex", ""])(
    "rejects the path %j",
    (path) => {
      expect(parseLatticeHostFileWrites(report([{ path, writtenAt: at(0) }]))).toBeNull();
    },
  );

  it("rejects another message type, version or a bad timestamp", () => {
    expect(parseLatticeHostFileWrites({ ...report([]), version: 2 })).toBeNull();
    expect(parseLatticeHostFileWrites({ ...report([]), type: "lattice:other" })).toBeNull();
    expect(
      parseLatticeHostFileWrites(report([{ path: "main.tex", writtenAt: "yesterday" }])),
    ).toBeNull();
  });
});

describe("attributeHostWrites", () => {
  const projectId = ProjectId.makeUnsafe("project-1");
  const projects = [{ id: projectId, kind: "project" as const, workspaceRoot: "/paper" }];
  const thread = (
    id: string,
    latestTurn: { requestedAt: string; completedAt: string | null } | null,
    extra: { projectId?: ProjectId; deletedAt?: string | null } = {},
  ) => ({
    id: ThreadId.makeUnsafe(id),
    projectId: extra.projectId ?? projectId,
    worktreePath: null,
    deletedAt: extra.deletedAt ?? null,
    latestTurn: latestTurn && { turnId: TurnId.makeUnsafe(`${id}-turn`), ...latestTurn },
  });
  const attribute = (threads: ReturnType<typeof thread>[], writtenAt: string) =>
    attributeHostWrites({
      report: parseLatticeHostFileWrites(report([{ path: "main.tex", writtenAt }]))!,
      threads,
      projects,
      sameWorkspace: (cwd) => cwd === "/paper",
    });

  it("records a write on the turn running in that workspace", () => {
    expect(attribute([thread("t1", { requestedAt: at(0), completedAt: null })], at(5_000))).toEqual(
      [
        {
          threadId: ThreadId.makeUnsafe("t1"),
          turnId: TurnId.makeUnsafe("t1-turn"),
          cwd: "/paper",
          paths: ["main.tex"],
        },
      ],
    );
  });

  it("counts a write just after the turn ended, before its snapshot may have run", () => {
    const ended = thread("t1", { requestedAt: at(0), completedAt: at(10_000) });
    expect(attribute([ended], at(10_000 + HOST_WRITE_TURN_END_SLACK_MS - 1))).toHaveLength(1);
    expect(attribute([ended], at(10_000 + HOST_WRITE_TURN_END_SLACK_MS + 1))).toEqual([]);
  });

  it("ignores writes before the turn, other workspaces, idle and deleted threads", () => {
    const running = { requestedAt: at(10_000), completedAt: null };
    expect(attribute([thread("t1", running)], at(5_000))).toEqual([]);
    expect(
      attribute([thread("t1", running, { projectId: ProjectId.makeUnsafe("other") })], at(20_000)),
    ).toEqual([]);
    expect(attribute([thread("t1", null)], at(20_000))).toEqual([]);
    expect(attribute([thread("t1", running, { deletedAt: at(0) })], at(20_000))).toEqual([]);
  });
});

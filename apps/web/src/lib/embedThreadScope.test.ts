import { ProjectId, ThreadId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import type { EmbedModeConfig } from "../embedMode";
import { syncServerReadModel } from "../storeProjection";
import { initialState } from "../storeState";
import { makeReadModel, makeReadModelProject, makeReadModelThread } from "../storeTestFixtures";
import {
  isForeignEmbeddedThread,
  listProjectThreadIdsByRecency,
  resolveEmbeddedProjectId,
} from "./embedThreadScope";

const alphaProjectId = ProjectId.makeUnsafe("project-alpha");
const betaProjectId = ProjectId.makeUnsafe("project-beta");
const alphaOld = ThreadId.makeUnsafe("thread-alpha-old");
const alphaNew = ThreadId.makeUnsafe("thread-alpha-new");
const betaThread = ThreadId.makeUnsafe("thread-beta");

function embedFor(workspaceRoot: string): EmbedModeConfig {
  return { workspaceRoot, theme: "light", surface: "chrome", hostOrigin: null, locale: "en" };
}

const state = syncServerReadModel(initialState, {
  ...makeReadModel(
    makeReadModelThread({
      id: alphaOld,
      projectId: alphaProjectId,
      updatedAt: "2026-02-27T00:00:00.000Z",
    }),
  ),
  projects: [
    makeReadModelProject({ id: alphaProjectId, workspaceRoot: "/work/alpha" }),
    makeReadModelProject({ id: betaProjectId, workspaceRoot: "/work/beta" }),
  ],
  threads: [
    makeReadModelThread({
      id: alphaOld,
      projectId: alphaProjectId,
      updatedAt: "2026-02-27T00:00:00.000Z",
    }),
    makeReadModelThread({
      id: alphaNew,
      projectId: alphaProjectId,
      updatedAt: "2026-02-28T00:00:00.000Z",
    }),
    makeReadModelThread({ id: betaThread, projectId: betaProjectId }),
  ],
});

describe("embedded thread scope", () => {
  it("binds the frame to the project of its workspace", () => {
    expect(resolveEmbeddedProjectId(state, embedFor("/work/alpha/"))).toBe(alphaProjectId);
    expect(resolveEmbeddedProjectId(state, embedFor("/work/gamma"))).toBeNull();
    expect(resolveEmbeddedProjectId(state, null)).toBeNull();
  });

  it("calls only a known thread of another project foreign", () => {
    const alpha = embedFor("/work/alpha");
    expect(isForeignEmbeddedThread(state, alpha, betaThread)).toBe(true);
    expect(isForeignEmbeddedThread(state, alpha, alphaNew)).toBe(false);
    // Not loaded yet: the thread route decides once it is.
    expect(isForeignEmbeddedThread(state, alpha, ThreadId.makeUnsafe("thread-unknown"))).toBe(
      false,
    );
    // Standalone Synara opens every thread.
    expect(isForeignEmbeddedThread(state, null, betaThread)).toBe(false);
    expect(isForeignEmbeddedThread(state, embedFor("/work/gamma"), betaThread)).toBe(false);
  });

  it("lists a project's threads most recent first", () => {
    expect(listProjectThreadIdsByRecency(state, alphaProjectId)).toEqual([alphaNew, alphaOld]);
    expect(listProjectThreadIdsByRecency(state, betaProjectId)).toEqual([betaThread]);
  });
});

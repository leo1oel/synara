import { describe, expect, it } from "vitest";

import { makeActivity } from "../storeTestFixtures";
import { deriveWorkLogEntries } from "../workLog";
import { isSummarizableToolCallEntry } from "../components/chat/toolCallGroup.logic";
import {
  collectThreadImageSequence,
  deriveWorkEntryImages,
  workEntryImageName,
  workEntryImagesEqual,
} from "./workEntryImages";

const SNAPSHOT = "/state/tool-images/thread-1/aaaa.png";
const LATER_SNAPSHOT = "/state/tool-images/thread-1/bbbb.png";

function snapshot(path: string) {
  return { path, mimeType: "image/png", byteLength: 1024 };
}

describe("deriveWorkEntryImages", () => {
  it("prefers the server's snapshots of what the tool returned", () => {
    expect(
      deriveWorkEntryImages({
        payload: { toolImages: [snapshot(SNAPSHOT), snapshot(SNAPSHOT), { path: "notes.txt" }] },
        itemType: "file_change",
        isFileChange: true,
        changedFiles: ["figure.svg"],
      }),
    ).toEqual([{ path: SNAPSHOT, snapshot: true }]);
  });

  it("previews the file a Codex view_image call attached", () => {
    expect(
      deriveWorkEntryImages({
        payload: { data: { item: { type: "imageView", path: "/work/figs/plot.png" } } },
        itemType: "image_view",
        isFileChange: false,
        changedFiles: ["/work/figs/plot.png"],
      }),
    ).toEqual([{ path: "/work/figs/plot.png", snapshot: false }]);
  });

  it("previews images a file-change call wrote, and never a read's path", () => {
    expect(
      deriveWorkEntryImages({
        payload: {},
        itemType: "file_change",
        isFileChange: true,
        changedFiles: ["paper.tex", "figs/diagram.svg"],
      }),
    ).toEqual([{ path: "figs/diagram.svg", snapshot: false }]);
    expect(
      deriveWorkEntryImages({
        payload: {},
        itemType: "dynamic_tool_call",
        isFileChange: false,
        changedFiles: ["figs/diagram.svg"],
      }),
    ).toEqual([]);
  });
});

describe("work log image previews", () => {
  it("carries snapshots from a completed tool call onto its row", () => {
    const [entry] = deriveWorkLogEntries(
      [
        makeActivity({
          id: "figure",
          kind: "tool.completed",
          summary: "Preview figure",
          payload: {
            itemType: "mcp_tool_call",
            status: "completed",
            title: "Preview figure",
            toolImages: [snapshot(SNAPSHOT)],
          },
        }),
      ],
      undefined,
    );
    expect(entry?.images).toEqual([{ path: SNAPSHOT, snapshot: true }]);
    // A row with a picture stays visible instead of folding into "Ran 3 tools".
    expect(isSummarizableToolCallEntry(entry!)).toBe(false);
  });

  it("leaves rows without images summarizable", () => {
    const [entry] = deriveWorkLogEntries(
      [
        makeActivity({
          kind: "tool.completed",
          payload: { itemType: "mcp_tool_call", status: "completed", title: "Search" },
        }),
      ],
      undefined,
    );
    expect(entry?.images).toBeUndefined();
    expect(isSummarizableToolCallEntry(entry!)).toBe(true);
  });
});

describe("thread image sequence", () => {
  const read = {
    images: [{ path: SNAPSHOT, snapshot: true }],
    detail: "/work/figs/loss curve.png",
    label: "Read",
  };
  const preview = {
    images: [{ path: LATER_SNAPSHOT, snapshot: true }],
    toolTitle: "Preview figure",
    label: "Tool",
  };
  const wrote = { images: [{ path: "figs/diagram.svg", snapshot: false }], label: "Edited" };

  it("lists snapshots in transcript order with readable names", () => {
    expect(collectThreadImageSequence([read, wrote, preview, read])).toEqual([
      { path: SNAPSHOT, name: "loss curve.png" },
      { path: LATER_SNAPSHOT, name: "Preview figure" },
    ]);
  });

  it("names a disk image by its file and an argument dump by the call", () => {
    expect(workEntryImageName(wrote, wrote.images[0]!)).toBe("diagram.svg");
    expect(
      workEntryImageName(
        { label: "Tool", toolTitle: "Screenshot", detail: 'Screenshot: {"out":"a.png"}' },
        { path: SNAPSHOT, snapshot: true },
      ),
    ).toBe("Screenshot");
  });

  it("compares image lists by content", () => {
    expect(
      workEntryImagesEqual(
        [{ path: SNAPSHOT, snapshot: true }],
        [{ path: SNAPSHOT, snapshot: true }],
      ),
    ).toBe(true);
    expect(workEntryImagesEqual([{ path: SNAPSHOT, snapshot: true }], undefined)).toBe(false);
    expect(workEntryImagesEqual(undefined, [])).toBe(true);
  });
});

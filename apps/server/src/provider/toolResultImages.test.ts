import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EventId, type ProviderRuntimeEvent, ThreadId } from "@synara/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compactProviderRuntimeEventForIngress } from "./providerRuntimeEventIngress.ts";
import {
  MAX_TOOL_RESULT_IMAGES_PER_EVENT,
  snapshotToolResultImages,
  snapshotToolResultImagesInBackground,
  toolResultImagesThreadDirectory,
} from "./toolResultImages.ts";

// Smallest valid headers for each raster type; the snapshot sniffs these bytes.
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("png-body")]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("jpeg-body")]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBPVP8 body"),
]);

function toolEvent(
  data: unknown,
  overrides: Partial<{
    type: "item.updated" | "item.completed";
    itemType: string;
    threadId: string;
  }> = {},
): ProviderRuntimeEvent {
  return {
    type: overrides.type ?? "item.completed",
    eventId: EventId.makeUnsafe("event-1"),
    provider: "claudeAgent",
    createdAt: "2026-11-12T00:00:00.000Z",
    threadId: ThreadId.makeUnsafe(overrides.threadId ?? "thread-1"),
    itemId: "tool-1",
    payload: {
      itemType: overrides.itemType ?? "mcp_tool_call",
      status: "completed",
      title: "Preview figure",
      data,
    },
  } as unknown as ProviderRuntimeEvent;
}

function toolImagesOf(event: ProviderRuntimeEvent): Array<{
  path: string;
  mimeType: string;
  byteLength: number;
}> {
  const data = (event as { payload: { data?: { toolImages?: unknown } } }).payload.data;
  return (data?.toolImages as never) ?? [];
}

describe("snapshotToolResultImages", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tool-images-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes MCP and Anthropic image blocks and records them in place of the bytes", async () => {
    const event = toolEvent({
      toolName: "preview_latex_figure",
      result: {
        type: "tool_result",
        content: [
          { type: "text", text: "Rendered at column width" },
          { type: "image", data: PNG.toString("base64"), mimeType: "image/png" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: JPEG.toString("base64") },
          },
        ],
      },
    });

    const snapshotted = await snapshotToolResultImages(event, root);
    const images = toolImagesOf(snapshotted);

    expect(images.map((image) => image.mimeType)).toEqual(["image/png", "image/jpeg"]);
    expect(images.map((image) => path.extname(image.path))).toEqual([".png", ".jpg"]);
    for (const image of images) {
      expect(path.dirname(image.path)).toBe(toolResultImagesThreadDirectory(root, "thread-1"));
    }
    expect(fs.readFileSync(images[0]!.path)).toEqual(PNG);
    expect(fs.readFileSync(images[1]!.path)).toEqual(JPEG);
    expect(images[0]!.byteLength).toBe(PNG.length);
    // The source event is not mutated; callers still strip the bytes afterwards.
    expect(toolImagesOf(event)).toEqual([]);
  });

  it("picks the extension from the bytes rather than the declared type", async () => {
    const event = toolEvent({
      content: [{ type: "image", data: WEBP.toString("base64"), mimeType: "image/png" }],
    });
    const [image] = toolImagesOf(await snapshotToolResultImages(event, root));
    expect(image).toMatchObject({ mimeType: "image/webp" });
    expect(image!.path.endsWith(".webp")).toBe(true);
  });

  it("reads data-URL images too", async () => {
    const event = toolEvent({
      item: { image_url: `data:image/png;base64,${PNG.toString("base64")}` },
    });
    expect(toolImagesOf(await snapshotToolResultImages(event, root))).toHaveLength(1);
  });

  it("never writes bytes that are not a supported raster image", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    const event = toolEvent({
      content: [
        { type: "image", data: svg.toString("base64"), mimeType: "image/svg+xml" },
        {
          type: "image",
          data: Buffer.from("not an image").toString("base64"),
          mimeType: "image/png",
        },
      ],
    });
    expect(await snapshotToolResultImages(event, root)).toBe(event);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("shares one file between the updated and completed events and an unchanged re-read", async () => {
    const data = {
      content: [{ type: "image", data: PNG.toString("base64"), mimeType: "image/png" }],
    };
    const updated = toolImagesOf(
      await snapshotToolResultImages(toolEvent(data, { type: "item.updated" }), root),
    );
    const completed = toolImagesOf(await snapshotToolResultImages(toolEvent(data), root));
    expect(updated[0]!.path).toBe(completed[0]!.path);
    expect(fs.readdirSync(toolResultImagesThreadDirectory(root, "thread-1"))).toHaveLength(1);
  });

  it("keeps a changed figure as a new version", async () => {
    const first = toolImagesOf(
      await snapshotToolResultImages(
        toolEvent({ content: [{ type: "image", data: PNG.toString("base64") }] }),
        root,
      ),
    );
    const changed = Buffer.concat([PNG, Buffer.from("legend moved")]);
    const second = toolImagesOf(
      await snapshotToolResultImages(
        toolEvent({ content: [{ type: "image", data: changed.toString("base64") }] }),
        root,
      ),
    );
    expect(second[0]!.path).not.toBe(first[0]!.path);
    expect(fs.readFileSync(first[0]!.path)).toEqual(PNG);
  });

  it("leaves non-tool events, tool events without images, and a missing root untouched", async () => {
    const imageData = { content: [{ type: "image", data: PNG.toString("base64") }] };
    const assistant = toolEvent(imageData, { itemType: "assistant_message" });
    const plain = toolEvent({ content: [{ type: "text", text: "ok" }] });
    expect(await snapshotToolResultImages(assistant, root)).toBe(assistant);
    expect(await snapshotToolResultImages(plain, root)).toBe(plain);
    expect(await snapshotToolResultImages(toolEvent(imageData), undefined)).toEqual(
      toolEvent(imageData),
    );
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("keeps an unsafe thread id inside the snapshot root", async () => {
    const event = toolEvent(
      { content: [{ type: "image", data: PNG.toString("base64") }] },
      { threadId: "../../escape" },
    );
    const [image] = toolImagesOf(await snapshotToolResultImages(event, root));
    expect(path.relative(root, image!.path).startsWith("..")).toBe(false);
    expect(path.basename(path.dirname(image!.path))).toMatch(/^t_[0-9a-f]{32}$/);
  });

  it("caps the images recorded from one result", async () => {
    const content = Array.from({ length: MAX_TOOL_RESULT_IMAGES_PER_EVENT + 4 }, (_, index) => ({
      type: "image",
      data: Buffer.concat([PNG, Buffer.from(String(index))]).toString("base64"),
    }));
    expect(toolImagesOf(await snapshotToolResultImages(toolEvent({ content }), root))).toHaveLength(
      MAX_TOOL_RESULT_IMAGES_PER_EVENT,
    );
  });

  it("returns the event unchanged when the snapshot cannot be written", async () => {
    const blocked = path.join(root, "blocked");
    fs.writeFileSync(blocked, "a file where the root directory should be");
    const event = toolEvent({ content: [{ type: "image", data: PNG.toString("base64") }] });
    expect(await snapshotToolResultImages(event, blocked)).toBe(event);
  });

  it("records references at once on the synchronous ingress and writes in the background", async () => {
    const event = toolEvent({
      content: [{ type: "image", data: PNG.toString("base64"), mimeType: "image/png" }],
    });
    const background = snapshotToolResultImagesInBackground(event, root);
    const [reference] = toolImagesOf(background.event);
    await background.written;
    expect(fs.readFileSync(reference!.path)).toEqual(PNG);

    const { event: ingressed } = compactProviderRuntimeEventForIngress(event, {
      toolImagesRoot: root,
    });
    const data = (ingressed as { payload: { data: { content: Array<Record<string, unknown>> } } })
      .payload.data;
    expect(data.content[0]).toMatchObject({ synaraImageOmitted: true });
    expect(toolImagesOf(ingressed)).toEqual([reference]);
  });
});

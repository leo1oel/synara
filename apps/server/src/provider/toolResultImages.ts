// FILE: toolResultImages.ts
// Purpose: Snapshot the images a tool handed back to the model (an MCP image result,
//          Claude's Read of a PNG, a screenshot tool) into thread-scoped files before
//          diagnostic stripping drops their bytes, so the transcript can show the exact
//          picture the agent looked at, version by version.
// Layer: Server provider utility
// Exports: snapshot root resolver, the per-event snapshot transform, and its reference shape
// Depends on: node fs/crypto/path, the tool lifecycle item types from contracts.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  isToolLifecycleItemType,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ProviderRuntimeEvent,
} from "@synara/contracts";

export const TOOL_RESULT_IMAGES_DIRNAME = "tool-images";

/** Where snapshots live: inside the server state directory, one folder per thread. */
export function toolResultImagesRoot(stateDir: string): string {
  return path.join(stateDir, TOOL_RESULT_IMAGES_DIRNAME);
}

/** What the transcript receives in place of the stripped bytes. */
export interface ToolResultImageReference {
  readonly path: string;
  readonly mimeType: string;
  readonly byteLength: number;
}

// A single tool result realistically carries one or two images (a screenshot, a page
// render). The cap only bounds a pathological result that inlines a whole gallery.
export const MAX_TOOL_RESULT_IMAGES_PER_EVENT = 8;
const MAX_SCAN_DEPTH = 8;

// Snapshots are served by extension, so the extension comes from the bytes rather than
// the declared MIME type: a mislabelled payload still lands under the type it really is,
// and anything that is not one of these raster formats is never written.
const RASTER_SIGNATURES: ReadonlyArray<{
  readonly mimeType: string;
  readonly extension: string;
  readonly matches: (bytes: Buffer) => boolean;
}> = [
  {
    mimeType: "image/png",
    extension: ".png",
    matches: (bytes) =>
      bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  },
  {
    mimeType: "image/jpeg",
    extension: ".jpg",
    matches: (bytes) =>
      bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    mimeType: "image/gif",
    extension: ".gif",
    matches: (bytes) =>
      bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("latin1")),
  },
  {
    mimeType: "image/webp",
    extension: ".webp",
    matches: (bytes) =>
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
      bytes.subarray(8, 12).toString("latin1") === "WEBP",
  },
];

const DATA_IMAGE_URL_PATTERN = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// Image blocks arrive in the three shapes providers use for tool output:
//   MCP:        { type: "image", data, mimeType }
//   Anthropic:  { type: "image", source: { type: "base64", media_type, data } }
//   data URLs:  { image_url | imageUrl | url: "data:image/png;base64,..." }
function collectInlineImagePayloads(root: unknown): string[] {
  const payloads: string[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number): void => {
    if (payloads.length >= MAX_TOOL_RESULT_IMAGES_PER_EVENT || depth > MAX_SCAN_DEPTH) return;
    if (Array.isArray(value)) {
      if (seen.has(value)) return;
      seen.add(value);
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    const record = asRecord(value);
    if (!record || seen.has(record)) return;
    seen.add(record);
    if (record.type === "image") {
      const source = asRecord(record.source);
      const base64 =
        nonEmptyString(record.data) ??
        (source?.type === "base64" ? nonEmptyString(source.data) : undefined);
      if (base64) {
        payloads.push(base64);
        return;
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (
        (key === "image_url" || key === "imageUrl" || key === "url") &&
        typeof child === "string" &&
        DATA_IMAGE_URL_PATTERN.test(child)
      ) {
        payloads.push(child.slice(child.indexOf(",") + 1));
        if (payloads.length >= MAX_TOOL_RESULT_IMAGES_PER_EVENT) return;
        continue;
      }
      visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return payloads;
}

// Thread ids are opaque strings; only a conservative character set becomes a directory
// name as-is, anything else is hashed so it can never climb out of the snapshot root.
function threadDirectoryName(threadId: string): string {
  return /^[A-Za-z0-9_-]{1,128}$/.test(threadId)
    ? threadId
    : `t_${createHash("sha256").update(threadId).digest("hex").slice(0, 32)}`;
}

export function toolResultImagesThreadDirectory(root: string, threadId: string): string {
  return path.join(root, threadDirectoryName(threadId));
}

function writeSnapshot(directory: string, base64: string): ToolResultImageReference | undefined {
  // Decoded size is bounded before decoding so an oversized payload costs nothing.
  if (Math.floor((base64.length * 3) / 4) > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES + 3)
    return undefined;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.length > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) return undefined;
  const signature = RASTER_SIGNATURES.find((candidate) => candidate.matches(bytes));
  if (!signature) return undefined;
  // Content addressing makes the item.updated/item.completed pair, and a re-read of an
  // unchanged figure, share one file; a changed figure gets a new one.
  const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}${signature.extension}`;
  const filePath = path.join(directory, name);
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.part`;
    try {
      fs.writeFileSync(temporaryPath, bytes, { mode: 0o600, flag: "wx" });
      fs.renameSync(temporaryPath, filePath);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
  return { path: filePath, mimeType: signature.mimeType, byteLength: bytes.length };
}

/**
 * Writes every inline image in a tool lifecycle event's data to the thread's snapshot
 * folder and records the files as `data.toolImages`. The bytes themselves stay in the
 * event: callers strip them afterwards exactly as before. A write that fails only
 * costs the preview, never the event.
 */
export function snapshotToolResultImages(
  event: ProviderRuntimeEvent,
  root: string | undefined,
): ProviderRuntimeEvent {
  if (!root || (event.type !== "item.updated" && event.type !== "item.completed")) return event;
  if (!isToolLifecycleItemType(event.payload.itemType)) return event;
  const data = asRecord(event.payload.data);
  if (!data) return event;
  const payloads = collectInlineImagePayloads(data);
  if (payloads.length === 0) return event;
  const directory = toolResultImagesThreadDirectory(root, event.threadId);
  const references: ToolResultImageReference[] = [];
  for (const base64 of payloads) {
    let reference: ToolResultImageReference | undefined;
    try {
      reference = writeSnapshot(directory, base64);
    } catch {
      reference = undefined;
    }
    if (reference && !references.some((existing) => existing.path === reference.path)) {
      references.push(reference);
    }
  }
  if (references.length === 0) return event;
  return {
    ...event,
    payload: { ...event.payload, data: { ...data, toolImages: references } },
  } as ProviderRuntimeEvent;
}

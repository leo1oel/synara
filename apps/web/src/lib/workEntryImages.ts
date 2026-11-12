// FILE: workEntryImages.ts
// Purpose: Decide which images a tool-call row previews inline: the server's snapshots of
//          images a tool returned to the model (Read of a PNG, an MCP screenshot, a
//          figure render), a Codex `view_image` path, or an image file a call wrote.
// Layer: Web chat presentation helpers
// Exports: WorkEntryImage, deriveWorkEntryImages, workEntryImagesEqual, workEntryImageName,
//          collectThreadImageSequence, threadImageSequencesEqual
// Depends on: the shared preview-file extension allowlist.

import { isSupportedLocalImagePath } from "@synara/shared/localPreviewFiles";

import { extractFilePathFromDetail } from "./toolArgumentSummary";

export interface WorkEntryImage {
  /** Path the local preview route serves: absolute, or relative to the thread's cwd. */
  readonly path: string;
  /**
   * A server-owned copy of the bytes the tool returned. It never changes after the
   * call, so it shows the version the agent saw even after the file is overwritten.
   */
  readonly snapshot: boolean;
}

// Matches the server's per-event cap; a row is a preview, not a gallery.
export const MAX_WORK_ENTRY_IMAGES = 8;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function imagePath(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 && isSupportedLocalImagePath(trimmed) ? trimmed : undefined;
}

function snapshotImages(payload: Record<string, unknown>): WorkEntryImage[] {
  if (!Array.isArray(payload.toolImages)) return [];
  return payload.toolImages.flatMap((entry) => {
    const path = imagePath(asRecord(entry)?.path);
    return path ? [{ path, snapshot: true }] : [];
  });
}

// Codex reports `view_image` as an `imageView` item that names the file it attached.
function viewedImagePath(payload: Record<string, unknown>): string | undefined {
  const data = asRecord(payload.data);
  const item = asRecord(data?.item);
  return imagePath(item?.path) ?? imagePath(data?.path) ?? imagePath(payload.detail);
}

export function deriveWorkEntryImages(input: {
  readonly payload: Record<string, unknown> | null | undefined;
  readonly itemType: string | undefined;
  /** Whether the call edits files; only then are its paths files it wrote. */
  readonly isFileChange: boolean;
  readonly changedFiles: ReadonlyArray<string>;
}): WorkEntryImage[] {
  const payload = input.payload;
  if (!payload) return [];
  // A snapshot is what the model actually received, so it wins over any path.
  const snapshots = snapshotImages(payload);
  if (snapshots.length > 0) return dedupe(snapshots);
  if (input.itemType === "image_view") {
    const path = viewedImagePath(payload);
    return path ? [{ path, snapshot: false }] : [];
  }
  // An SVG (or any image) a file-change call wrote is previewed from disk. The paths
  // other calls carry are what they read or searched; a snapshot covers an image read.
  if (!input.isFileChange) return [];
  return dedupe(
    input.changedFiles.flatMap((file) => {
      const path = imagePath(file);
      return path ? [{ path, snapshot: false }] : [];
    }),
  );
}

function dedupe(images: WorkEntryImage[]): WorkEntryImage[] {
  const seen = new Set<string>();
  return images
    .filter((image) => {
      if (seen.has(image.path)) return false;
      seen.add(image.path);
      return true;
    })
    .slice(0, MAX_WORK_ENTRY_IMAGES);
}

export function workEntryImagesEqual(
  left: ReadonlyArray<WorkEntryImage> | undefined,
  right: ReadonlyArray<WorkEntryImage> | undefined,
): boolean {
  if (left === right) return true;
  if ((left?.length ?? 0) !== (right?.length ?? 0)) return false;
  return (left ?? []).every(
    (image, index) =>
      image.path === right![index]!.path && image.snapshot === right![index]!.snapshot,
  );
}

function basename(filePath: string): string {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return slash >= 0 ? filePath.slice(slash + 1) : filePath;
}

interface ImageNamingEntry {
  readonly images?: ReadonlyArray<WorkEntryImage> | undefined;
  readonly detail?: string | undefined;
  readonly toolTitle?: string | undefined;
  readonly label: string;
}

/**
 * Caption for an image in the expanded viewer. A snapshot's file name is a content
 * hash, so it borrows the image file the call read when the row names one (Claude's
 * Read), and the call's own title otherwise (a screenshot or figure-preview tool).
 */
export function workEntryImageName(entry: ImageNamingEntry, image: WorkEntryImage): string {
  if (!image.snapshot) return basename(image.path);
  const readPath = entry.detail ? extractFilePathFromDetail(entry.detail) : null;
  if (readPath && isSupportedLocalImagePath(readPath)) return basename(readPath);
  return entry.toolTitle?.trim() || entry.label;
}

export interface ThreadImageSequenceItem {
  readonly path: string;
  readonly name: string;
}

/**
 * The thread's images in the order the agent saw them, for stepping through
 * iterations of a figure in the expanded viewer. Only snapshots qualify: a path
 * on disk shows today's file, so two rows naming it would show the same picture.
 */
export function collectThreadImageSequence(
  entries: Iterable<ImageNamingEntry>,
): ThreadImageSequenceItem[] {
  const sequence: ThreadImageSequenceItem[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const image of entry.images ?? []) {
      if (!image.snapshot || seen.has(image.path)) continue;
      seen.add(image.path);
      sequence.push({ path: image.path, name: workEntryImageName(entry, image) });
    }
  }
  return sequence;
}

export function threadImageSequencesEqual(
  left: ReadonlyArray<ThreadImageSequenceItem>,
  right: ReadonlyArray<ThreadImageSequenceItem>,
): boolean {
  return (
    left === right ||
    (left.length === right.length &&
      left.every(
        (item, index) => item.path === right[index]!.path && item.name === right[index]!.name,
      ))
  );
}

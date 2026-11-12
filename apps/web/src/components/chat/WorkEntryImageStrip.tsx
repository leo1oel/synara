// FILE: WorkEntryImageStrip.tsx
// Purpose: Inline thumbnails for the images tool calls returned to the model or wrote,
//          so the writer sees what the agent saw without opening the file.
// Layer: Chat transcript presentation component
// Exports: WorkEntryImageStrip (under one tool row), SettledTurnImageStrip (under a
//          settled turn's closed "Worked for" header)
// Notes: Each thumbnail is the shared GeneratedMarkdownImage (loading, grant renewal,
//        error card, download) in its thumbnail size. Expanding a snapshot opens the
//        thread's snapshot sequence at that image, so earlier and later versions of a
//        figure are one arrow key away.

import { useContext } from "react";

import { cn } from "~/lib/utils";
import { buildLocalImageUrl } from "~/lib/localImageUrls";
import {
  MAX_WORK_ENTRY_IMAGES,
  type WorkEntryImage,
  workEntryImageName,
} from "~/lib/workEntryImages";
import type { WorkLogEntry } from "../../session-logic";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { GeneratedMarkdownImage } from "./GeneratedMarkdownImage";
import { ThreadImageSequenceContext } from "./threadImageSequenceContext";

type ImageNamingEntry = Pick<WorkLogEntry, "images" | "detail" | "toolTitle" | "label">;

interface StripItem {
  readonly image: WorkEntryImage;
  readonly name: string;
}

interface StripContext {
  readonly cwd: string | undefined;
  readonly threadId?: string | null | undefined;
  readonly onImageExpand: (preview: ExpandedImagePreview) => void;
}

function ImageThumbnailStrip(
  props: StripContext & { items: ReadonlyArray<StripItem>; className: string },
) {
  const { items, cwd, threadId, onImageExpand, className } = props;
  const sequence = useContext(ThreadImageSequenceContext);
  if (items.length === 0) return null;

  // The thumbnail resolved its own URL (with a grant when the path needed one); the
  // rest of the sequence are snapshots, which the preview route serves directly.
  const expandWithSequence = (item: StripItem, preview: ExpandedImagePreview) => {
    const opened = preview.images[preview.index];
    if (!opened) return onImageExpand(preview);
    const index = item.image.snapshot
      ? sequence.findIndex((entry) => entry.path === item.image.path)
      : -1;
    if (index < 0 || sequence.length < 2) {
      onImageExpand({ images: [{ src: opened.src, name: item.name }], index: 0 });
      return;
    }
    onImageExpand({
      images: sequence.map((entry, entryIndex) => ({
        src: entryIndex === index ? opened.src : buildLocalImageUrl({ src: entry.path, cwd }),
        name: entry.name,
      })),
      index,
    });
  };

  return (
    <div className={cn("flex flex-wrap gap-2", className)} data-work-entry-images="true">
      {items.map((item) => (
        <GeneratedMarkdownImage
          key={item.image.path}
          src={item.image.path}
          alt={item.name}
          cwd={cwd}
          threadId={threadId}
          size="thumbnail"
          onImageExpand={(preview) => expandWithSequence(item, preview)}
        />
      ))}
    </div>
  );
}

export function WorkEntryImageStrip(
  props: StripContext & { workEntry: ImageNamingEntry; compact: boolean },
) {
  const { workEntry, compact, ...context } = props;
  const items = (workEntry.images ?? []).map((image) => ({
    image,
    name: workEntryImageName(workEntry, image),
  }));
  return (
    <ImageThumbnailStrip {...context} items={items} className={compact ? "pl-[22px]" : "pl-7"} />
  );
}

/**
 * A settled turn folds its tool rows into the "Worked for" header; the pictures the
 * agent looked at stay visible below it so the writer can react to them without
 * reopening the turn. The latest images win when a turn saw more than fit.
 */
export function SettledTurnImageStrip(
  props: StripContext & { entries: ReadonlyArray<ImageNamingEntry> },
) {
  const { entries, ...context } = props;
  const seen = new Set<string>();
  const items: StripItem[] = [];
  for (const entry of entries) {
    for (const image of entry.images ?? []) {
      if (seen.has(image.path)) continue;
      seen.add(image.path);
      items.push({ image, name: workEntryImageName(entry, image) });
    }
  }
  return (
    <ImageThumbnailStrip
      {...context}
      items={items.slice(-MAX_WORK_ENTRY_IMAGES)}
      className="pt-1.5"
    />
  );
}

// FILE: WorkEntryImageStrip.tsx
// Purpose: Inline thumbnails under a tool-call row for the images the call returned to
//          the model or wrote, so the writer sees what the agent saw without opening it.
// Layer: Chat transcript presentation component
// Exports: WorkEntryImageStrip
// Notes: Each thumbnail is the shared GeneratedMarkdownImage (loading, grant renewal,
//        error card, download) in its thumbnail size. Expanding a snapshot opens the
//        thread's snapshot sequence at that image, so earlier and later versions of a
//        figure are one arrow key away.

import { useContext } from "react";

import { cn } from "~/lib/utils";
import { buildLocalImageUrl } from "~/lib/localImageUrls";
import { type WorkEntryImage, workEntryImageName } from "~/lib/workEntryImages";
import type { WorkLogEntry } from "../../session-logic";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { GeneratedMarkdownImage } from "./GeneratedMarkdownImage";
import { ThreadImageSequenceContext } from "./threadImageSequenceContext";

export function WorkEntryImageStrip(props: {
  workEntry: Pick<WorkLogEntry, "images" | "detail" | "toolTitle" | "label">;
  cwd: string | undefined;
  threadId?: string | null | undefined;
  compact: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
}) {
  const { workEntry, cwd, threadId, compact, onImageExpand } = props;
  const sequence = useContext(ThreadImageSequenceContext);
  const images = workEntry.images ?? [];
  if (images.length === 0) return null;

  // The thumbnail resolved its own URL (with a grant when the path needed one); the
  // rest of the sequence are snapshots, which the preview route serves directly.
  const expandWithSequence = (image: WorkEntryImage, preview: ExpandedImagePreview) => {
    const opened = preview.images[preview.index];
    const index = image.snapshot ? sequence.findIndex((item) => item.path === image.path) : -1;
    if (!opened || index < 0 || sequence.length < 2) {
      onImageExpand(
        opened
          ? { images: [{ ...opened, name: workEntryImageName(workEntry, image) }], index: 0 }
          : preview,
      );
      return;
    }
    onImageExpand({
      images: sequence.map((item, itemIndex) => ({
        src: itemIndex === index ? opened.src : buildLocalImageUrl({ src: item.path, cwd }),
        name: item.name,
      })),
      index,
    });
  };

  return (
    <div
      className={cn("flex flex-wrap gap-2", compact ? "pl-[22px]" : "pl-7")}
      data-work-entry-images="true"
    >
      {images.map((image) => (
        <GeneratedMarkdownImage
          key={image.path}
          src={image.path}
          alt={workEntryImageName(workEntry, image)}
          cwd={cwd}
          threadId={threadId}
          size="thumbnail"
          onImageExpand={(preview) => expandWithSequence(image, preview)}
        />
      ))}
    </div>
  );
}

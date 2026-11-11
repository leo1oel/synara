// FILE: FileRowsSkeleton.tsx
// Purpose: Shared loading placeholder for file lists (review file tree, source-control
//          lists) so every pending list previews the same icon + path row shape.
// Layer: Chat/shared UI

import { Skeleton } from "../ui/skeleton";
import { cn } from "~/lib/utils";
import { fileRowIndentStyle } from "./fileRowStyles";

const FILE_ROWS_SKELETON_WIDTHS = ["w-9/12", "w-6/12", "w-8/12", "w-5/12", "w-7/12"];

export function FileRowsSkeleton(props: {
  label: string;
  /** Alternate the indent like a directory tree. */
  nested?: boolean;
  /** Reserve the trailing `+N −M` stat column of flat change lists. */
  showStats?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", props.className)} role="status" aria-label={props.label}>
      {FILE_ROWS_SKELETON_WIDTHS.map((width, index) => (
        <div
          key={width}
          className="flex h-5 items-center gap-1.5"
          style={props.nested ? fileRowIndentStyle(index % 2) : undefined}
        >
          <Skeleton className="size-3.5 shrink-0 rounded-sm" />
          <Skeleton className={cn("h-3 rounded-full", width)} />
          {props.showStats ? <Skeleton className="ml-auto h-3 w-9 shrink-0 rounded-full" /> : null}
        </div>
      ))}
    </div>
  );
}

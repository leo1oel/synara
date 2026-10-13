// FILE: ResearchArt.tsx
// Purpose: Lattice's research-desk drawings for the embedded Git views' larger empty states:
//          dated drafts for a clean Changes view, a routing envelope for Pull requests.
// Layer: Embedded presentation
// Exports: ResearchArt, ResearchDrawing, ResearchArtTone
//
// The drawings are Lattice's own family (its `research-art.tsx`), ported as path data: one
// monochrome isometric object on a 160x124 box, line work in the host's tertiary ink over
// paper in the surface it sits on (`--art-paper`), with faint tones for the sides. Static and
// decorative; the empty state's text says what it means. Styles: `.research-art` in index.css.

import { cn } from "~/lib/utils";

export type ResearchArtTone =
  | "paper"
  | "shade"
  | "shade-mid"
  | "shade-deep"
  | "faint"
  | "line"
  | "dot";

export type ResearchDrawing = {
  kind: string;
  paths: ReadonlyArray<readonly [ResearchArtTone, string]>;
};

export function ResearchArt({
  drawing,
  className,
}: {
  drawing: ResearchDrawing;
  className?: string;
}) {
  return (
    <svg
      className={cn("research-art", className)}
      data-kind={drawing.kind}
      viewBox="0 0 160 124"
      aria-hidden="true"
      focusable="false"
    >
      {drawing.paths.map(([tone, d]) => (
        <path key={`${tone}:${d}`} data-tone={tone} d={d} />
      ))}
    </svg>
  );
}

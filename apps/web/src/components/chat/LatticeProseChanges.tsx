// FILE: LatticeProseChanges.tsx
// Purpose: Changed lines of a paper drawn as sentences in the reading font, with deleted words
//          struck through and inserted words washed in, under their line numbers. Lattice's
//          Changes view and pull request redline both read a change this way.
// Layer: Embedded Git presentation
// Exports: ProseChangeList, ProseChangeText

import { useLingui } from "@lingui/react";
import type { ReactNode } from "react";

import type { ProseChange, ProseSegment } from "~/lib/proseDiff";

export function ProseChangeText({ segments }: { segments: ProseSegment[] }) {
  const { i18n } = useLingui();
  // Runs are keyed by where they start in the joined text, which is stable for a change.
  let offset = 0;
  const runs = segments.map((segment) => {
    const key = `${segment.kind}:${offset}`;
    offset += segment.text.length;
    return { key, segment };
  });
  return (
    <span className="lattice-prose-text">
      {runs.map(({ key, segment }) =>
        segment.kind === "same" ? (
          <span key={key}>{segment.text}</span>
        ) : segment.kind === "del" ? (
          <del key={key} title={i18n._("Deleted")}>
            {segment.text}
          </del>
        ) : (
          <ins key={key} title={i18n._("Inserted")}>
            {segment.text}
          </ins>
        ),
      )}
    </span>
  );
}

export function ProseChangeList({
  changes,
  renderAfter,
}: {
  changes: ProseChange[];
  /** Anything that belongs under a change, such as the comments left on its line. */
  renderAfter?: (change: ProseChange) => ReactNode;
}) {
  const { i18n } = useLingui();
  return (
    <ol className="lattice-prose-changes">
      {changes.map((change) => (
        <li
          key={`${change.line}:${change.segments.map((segment) => segment.kind).join("")}`}
          className="lattice-prose-change"
        >
          <span
            className="lattice-prose-line"
            aria-label={i18n._("Line {line}", { line: change.line })}
          >
            {change.line}
          </span>
          <ProseChangeText segments={change.segments} />
          {renderAfter?.(change)}
        </li>
      ))}
    </ol>
  );
}

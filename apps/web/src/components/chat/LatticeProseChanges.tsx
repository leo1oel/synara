import { t } from "~/i18n";

import type { ReactNode } from "react";

import type { ProseChange, ProseSegment } from "~/lib/proseDiff";

export function ProseChangeText({ segments }: { segments: ProseSegment[] }) {
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
          <del key={key} title={t("lattice:deleted")}>
            {segment.text}
          </del>
        ) : (
          <ins key={key} title={t("lattice:inserted")}>
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
  return (
    <ol className="lattice-prose-changes">
      {changes.map((change) => (
        <li
          key={`${change.line}:${change.segments.map((segment) => segment.kind).join("")}`}
          className="lattice-prose-change"
        >
          <span
            className="lattice-prose-line"
            aria-label={t("lattice:line", { line: change.line })}
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

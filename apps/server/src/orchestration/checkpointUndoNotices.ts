// What checkpoint Undo tells the user when it keeps edits that are not the
// agent's. Kept beside the reactor rather than inside it so the wording, and
// the rule for which files a host write blocks, can be tested directly.

/** Files of one undone turn that the host also wrote while that turn ran. */
export function hostWrittenUndoPaths(
  turnFiles: ReadonlyArray<string>,
  hostWrites: ReadonlyArray<string>,
): string[] {
  const written = new Set(hostWrites);
  return turnFiles.filter((file) => written.has(file));
}

const fileList = (paths: ReadonlyArray<string>) => {
  const shown = paths.slice(0, 3).join(", ");
  return paths.length > 3 ? `${shown} and ${paths.length - 3} more` : shown;
};

/**
 * Refusal for a turn whose diff swallowed edits the host wrote while it ran.
 * Reversing that diff would delete them, and the turn's snapshots cannot tell
 * them apart from the agent's own lines.
 */
export function hostWriteUndoBlockDetail(paths: ReadonlyArray<string>): string {
  return (
    `A co-author's edit or your own landed in ${fileList(paths)} while the agent was working, ` +
    "so undoing this turn would remove it too. Reject the agent's change in review mode, or edit the file by hand."
  );
}

/** Notice for an Undo that kept overlapping edits as conflicts. */
export function revertConflictDetail(paths: ReadonlyArray<string>): string {
  return (
    `Undo kept the edits made since this checkpoint. Where they changed the agent's own lines in ${fileList(paths)}, ` +
    "both versions are marked as a conflict; resolve those spots to finish."
  );
}

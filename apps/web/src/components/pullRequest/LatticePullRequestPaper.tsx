// FILE: LatticePullRequestPaper.tsx
// Purpose: Lattice's "In the paper" reading of a pull request, like a red-pen proof: the serif
//          title, who is asked to review and what they said, then the changed sentences of the
//          paper by section in the reading font with each review comment under its sentence,
//          and Comment · Approve · Merge at the foot.
// Layer: Embedded pull request presentation (Lattice host only)
// Depends on: the pull request diff query, lib/proseDiff, and the detail panel's own runners
//             for merge (with its confirmation) and approve.

import { useLingui } from "@lingui/react";
import type {
  PullRequestActor,
  PullRequestComment,
  PullRequestDetail,
  PullRequestDetailInput,
} from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { LoaderCircleIcon } from "~/lib/icons";
import { pullRequestCommentMutationOptions } from "~/lib/pullRequestMutationOptions";
import { pullRequestDiffQueryOptions } from "~/lib/pullRequestReactQuery";
import { isProsePath, readProseChanges, splitPatchByFile, type ProseChange } from "~/lib/proseDiff";
import { formatRelativeTime } from "~/lib/relativeTime";
import { ProseChangeList } from "../chat/LatticeProseChanges";
import { toastManager } from "../ui/toast";
import type { PullRequestPrimaryAction } from "./PullRequestActions";
import { PullRequestAvatar } from "./PullRequestAvatar";
import { PullRequestStateGlyph } from "./PullRequestStateGlyph";
import { localizeGitHubStateLabel } from "./pullRequestStatePresentation";

interface PaperGroup {
  key: string;
  path: string;
  section: string | null;
  changes: ProseChange[];
}

function displayName(actor: PullRequestActor | null): string {
  return actor?.name?.trim() || actor?.login || "";
}

function firstName(actor: PullRequestActor | null): string {
  const name = actor?.name?.trim();
  return name ? (name.split(/\s+/)[0] ?? name) : (actor?.login ?? "");
}

/** Each reviewer's latest verdict, newest review winning; requested reviewers without one too. */
function reviewerStates(detail: PullRequestDetail) {
  const verdicts = new Map<string, string>();
  for (const comment of detail.comments) {
    if (comment.kind !== "review" || !comment.author || !comment.reviewState) continue;
    verdicts.set(comment.author.login.toLowerCase(), comment.reviewState.toUpperCase());
  }
  const authorLogin = detail.author?.login.toLowerCase() ?? null;
  return detail.reviewers
    .filter((actor) => actor.login.toLowerCase() !== authorLogin)
    .map((actor) => ({ actor, verdict: verdicts.get(actor.login.toLowerCase()) ?? null }));
}

/** The paper's changed sentences, grouped by file and section in the order they appear. */
function readPaper(patch: string): {
  groups: PaperGroup[];
  otherFiles: string[];
  changeCount: number;
  truncated: boolean;
} {
  const groups: PaperGroup[] = [];
  const otherFiles: string[] = [];
  let changeCount = 0;
  let truncated = false;
  for (const [path, filePatch] of splitPatchByFile(patch)) {
    if (!isProsePath(path)) {
      otherFiles.push(path);
      continue;
    }
    const read = readProseChanges(filePatch);
    truncated ||= read.truncated;
    for (const change of read.changes) {
      changeCount += 1;
      const last = groups.at(-1);
      if (last && last.path === path && last.section === change.section) {
        last.changes.push(change);
      } else {
        groups.push({
          key: `${path}:${change.section ?? ""}:${change.line}`,
          path,
          section: change.section,
          changes: [change],
        });
      }
    }
  }
  return { groups, otherFiles, changeCount, truncated };
}

export function LatticePullRequestPaper(props: {
  input: PullRequestDetailInput;
  detail: PullRequestDetail;
  primaryAction: PullRequestPrimaryAction | null;
  actionPending: boolean;
  pendingAction: string | null;
  onMerge: () => void;
  onReady: () => void;
  onApprove: () => void;
  onOpenFiles: () => void;
}) {
  const { i18n } = useLingui();
  const { detail } = props;
  const queryClient = useQueryClient();
  const diffQuery = useQuery(pullRequestDiffQueryOptions(props.input));
  const commentMutation = useMutation(pullRequestCommentMutationOptions(queryClient));
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");

  const paper = diffQuery.data ? readPaper(diffQuery.data.patch) : null;
  const sectionCount = paper
    ? new Set(paper.groups.map((group) => `${group.path}:${group.section ?? ""}`)).size
    : 0;
  const prosePaths = new Set(paper?.groups.map((group) => group.path) ?? []);
  const showFileNames = prosePaths.size > 1;
  const reviewComments = detail.comments.filter(
    (comment): comment is PullRequestComment & { path: string } =>
      comment.kind === "review-comment" && comment.path !== null,
  );
  const commentsAt = (path: string, line: number) =>
    reviewComments.filter((comment) => comment.path === path && comment.line === line);
  const anchored = new Set(
    paper?.groups.flatMap((group) =>
      group.changes.flatMap((change) =>
        commentsAt(group.path, change.line).map((comment) => comment.id),
      ),
    ) ?? [],
  );
  const looseComments = reviewComments.filter((comment) => !anchored.has(comment.id));
  const reviewers = reviewerStates(detail);
  const open = detail.state === "open";

  const sendComment = () => {
    const body = draft.trim();
    if (!body || commentMutation.isPending) return;
    commentMutation.mutate(
      { ...props.input, body },
      {
        onSuccess: () => {
          setDraft("");
          setComposing(false);
          toastManager.add({ type: "success", title: i18n._("Comment posted") });
        },
        onError: (error) =>
          toastManager.add({
            type: "error",
            title: i18n._("Could not post the comment"),
            description: error instanceof Error ? error.message : i18n._("An error occurred."),
          }),
      },
    );
  };

  const verdictLabel = (actor: PullRequestActor, verdict: string | null) => {
    const name = firstName(actor);
    switch (verdict) {
      case "APPROVED":
        return i18n._("{name} approved", { name });
      case "CHANGES_REQUESTED":
        return i18n._("{name} asked for changes", { name });
      case "COMMENTED":
        return i18n._("{name} commented", { name });
      default:
        return i18n._("{name} has not reviewed", { name });
    }
  };

  return (
    <div className="lattice-git lattice-paper" data-lattice-pr-paper="">
      <div className="lattice-git-scroll lattice-paper-scroll">
        <header className="lattice-paper-head">
          <span
            className="lattice-paper-state"
            data-state={detail.isDraft ? "draft" : detail.state}
          >
            <PullRequestStateGlyph
              state={detail.state}
              isDraft={detail.isDraft}
              mergeability={detail.mergeability}
              className="size-3.5"
            />
            <span>
              {localizeGitHubStateLabel(
                detail.isDraft && detail.state === "open"
                  ? "Draft"
                  : detail.state === "merged"
                    ? "Merged"
                    : detail.state === "closed"
                      ? "Closed"
                      : "Open",
              )}
            </span>
          </span>
          <h2 className="lattice-paper-title">
            {detail.title} <span className="lattice-paper-number">#{detail.number}</span>
          </h2>
          <p className="lattice-paper-meta">
            <span
              className="lattice-paper-branches"
              title={`${detail.headBranch} → ${detail.baseBranch}`}
            >
              {detail.headBranch} → {detail.baseBranch}
            </span>
            {detail.author ? (
              <span className="lattice-paper-author">
                <PullRequestAvatar actor={detail.author} size="sm" />
                <span>{displayName(detail.author)}</span>
              </span>
            ) : null}
            {paper && paper.changeCount > 0 ? (
              <span>
                {i18n._(
                  "{count, plural, one {# change} other {# changes}} in {sections, plural, one {# section} other {# sections}}",
                  { count: paper.changeCount, sections: sectionCount },
                )}
              </span>
            ) : null}
          </p>
          {reviewers.length > 0 ? (
            <p className="lattice-paper-reviewers">
              <span className="lattice-paper-avatars" aria-hidden>
                {reviewers.slice(0, 4).map(({ actor }) => (
                  <PullRequestAvatar key={actor.login} actor={actor} size="md" />
                ))}
              </span>
              <span>
                {reviewers.map(({ actor, verdict }) => verdictLabel(actor, verdict)).join(" · ")}
              </span>
            </p>
          ) : null}
        </header>

        {diffQuery.isPending ? (
          <p className="lattice-paper-note" role="status">
            <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" />
            {i18n._("Reading the changes…")}
          </p>
        ) : diffQuery.isError || !paper ? (
          <p className="lattice-paper-note">
            {i18n._("The changes could not be read.")}{" "}
            <button type="button" className="lattice-git-link" onClick={props.onOpenFiles}>
              {i18n._("Open Files")}
            </button>
          </p>
        ) : paper.groups.length === 0 ? (
          <p className="lattice-paper-note">
            {i18n._("No sentences of the paper changed.")}{" "}
            <button type="button" className="lattice-git-link" onClick={props.onOpenFiles}>
              {i18n._("Open Files")}
            </button>
          </p>
        ) : (
          <div className="lattice-paper-sections">
            {paper.groups.map((group) => (
              <section key={group.key} className="lattice-paper-section">
                <h3>
                  <span>{group.section ?? group.path}</span>
                  {showFileNames && group.section ? (
                    <span className="lattice-paper-file">{group.path}</span>
                  ) : null}
                </h3>
                <div className="lattice-paper-sheet">
                  <ProseChangeList
                    changes={group.changes}
                    renderAfter={(change) => {
                      const comments = commentsAt(group.path, change.line);
                      return comments.length > 0 ? (
                        <ul className="lattice-paper-comments">
                          {comments.map((comment) => (
                            <PaperComment key={comment.id} comment={comment} />
                          ))}
                        </ul>
                      ) : null;
                    }}
                  />
                </div>
              </section>
            ))}
            {paper.truncated ? (
              <p className="lattice-paper-note">
                {i18n._("Only the first changes of a long file are shown here.")}
              </p>
            ) : null}
          </div>
        )}

        {looseComments.length > 0 ? (
          <section className="lattice-paper-section">
            <h3>
              <span>{i18n._("Other review comments")}</span>
            </h3>
            <ul className="lattice-paper-comments lattice-paper-comments-loose">
              {looseComments.map((comment) => (
                <PaperComment key={comment.id} comment={comment} showPath />
              ))}
            </ul>
          </section>
        ) : null}

        {paper && paper.otherFiles.length > 0 ? (
          <p className="lattice-paper-note lattice-paper-other">
            <span>
              {i18n._("{count, plural, one {# other file changed} other {# other files changed}}", {
                count: paper.otherFiles.length,
              })}
              {": "}
              <span className="lattice-paper-other-files">{paper.otherFiles.join(", ")}</span>
            </span>
            <button type="button" className="lattice-git-link" onClick={props.onOpenFiles}>
              {i18n._("Open Files")}
            </button>
          </p>
        ) : null}
      </div>

      {open ? (
        <footer className="lattice-paper-actions">
          {composing ? (
            <form
              className="lattice-paper-composer"
              onSubmit={(event) => {
                event.preventDefault();
                sendComment();
              }}
            >
              <textarea
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the Comment button
                autoFocus
                aria-label={i18n._("Comment…")}
                placeholder={i18n._("Leave a comment on this pull request")}
                rows={3}
                maxLength={65_536}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    sendComment();
                  } else if (event.key === "Escape") {
                    setComposing(false);
                  }
                }}
              />
              <div className="lattice-paper-action-row">
                <button
                  type="button"
                  className="lattice-git-button"
                  onClick={() => setComposing(false)}
                >
                  {i18n._("Cancel")}
                </button>
                <button
                  type="submit"
                  className="lattice-git-button lattice-git-primary"
                  disabled={!draft.trim() || commentMutation.isPending}
                >
                  {commentMutation.isPending ? i18n._("Posting…") : i18n._("Post comment")}
                </button>
              </div>
            </form>
          ) : (
            <div className="lattice-paper-action-row">
              <button
                type="button"
                className="lattice-git-button"
                onClick={() => setComposing(true)}
              >
                {i18n._("Comment…")}
              </button>
              <button
                type="button"
                className="lattice-git-button lattice-git-tinted"
                disabled={props.actionPending}
                onClick={props.onApprove}
              >
                {props.pendingAction === "approve" ? i18n._("Approving…") : i18n._("Approve")}
              </button>
              {props.primaryAction?.kind === "ready" ? (
                <button
                  type="button"
                  className="lattice-git-button lattice-git-primary"
                  disabled={props.actionPending}
                  onClick={props.onReady}
                >
                  {i18n._("Ready for review")}
                </button>
              ) : props.primaryAction?.kind === "merge" ? (
                <button
                  type="button"
                  className="lattice-git-button lattice-git-primary"
                  disabled={props.actionPending || props.primaryAction.blockedReason !== null}
                  title={props.primaryAction.blockedReason ?? undefined}
                  onClick={props.onMerge}
                >
                  {props.pendingAction === "merge" ? i18n._("Merging…") : i18n._("Merge")}
                </button>
              ) : null}
            </div>
          )}
        </footer>
      ) : null}
    </div>
  );
}

function PaperComment({ comment, showPath }: { comment: PullRequestComment; showPath?: boolean }) {
  return (
    <li className="lattice-paper-comment">
      <PullRequestAvatar actor={comment.author} size="sm" />
      <span className="lattice-paper-comment-body">
        <strong>{firstName(comment.author)}</strong>{" "}
        {showPath && comment.path ? (
          <span className="lattice-paper-file">{comment.path} </span>
        ) : null}
        <span>{comment.body}</span>
      </span>
      <time dateTime={comment.createdAt}>{formatRelativeTime(comment.createdAt)}</time>
    </li>
  );
}

// FILE: LatticePullRequestList.tsx
// Purpose: Lattice's embedded Pull requests list: grouped by what needs the writer (Needs your
//          review, Yours, the rest still open, Recently merged), one row per pull request with
//          its state, `#14 · head → base · who · age`, checks and comments; and an empty state
//          that says why it is empty (no pull requests, not on GitHub, GitHub CLI signed out).
// Layer: Embedded GitHub inbox presentation (Lattice host only; standalone keeps the inbox list)
// Depends on: the project-scoped inbox lists, and GitActionsControl's `lattice` variant for the
//             Create PR dialog behind New and "Open a pull request from <branch>".

import type {
  GitHubInboxListResult,
  GitHubInboxPullRequestItem,
  ProjectId,
} from "@synara/contracts";
import { useLingui } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import { type ClipboardEvent, type ReactNode, useState } from "react";

import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CopyIcon,
  CreatePullRequestIcon,
  GitHubIcon,
  LinkIcon,
  MessageCircleIcon,
  SearchIcon,
  XIcon,
} from "~/lib/icons";
import { gitBranchesQueryOptions } from "~/lib/gitReactQuery";
import { githubInboxListQueryOptions } from "~/lib/pullRequestReactQuery";
import { isPullRequestsUnavailableError } from "~/lib/pullRequestErrors";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import GitActionsControl from "../GitActionsControl";
import {
  GitHubRepositorySetupDialog,
  LatticeErrorDetails,
  LatticeGitInitializeButton,
} from "../chat/GitRepositorySetup";
import { PullRequestStateGlyph } from "../pullRequest/PullRequestStateGlyph";
import { ResearchArt } from "../researchArt/ResearchArt";
import { ROUTING_ENVELOPE } from "../researchArt/routingEnvelope";
import { toastManager } from "../ui/toast";

/** Merged pull requests this recent, and at most this many, make Recently merged. */
const RECENTLY_MERGED_DAYS = 30;
const RECENTLY_MERGED_LIMIT = 5;

type GroupKey = "review" | "yours" | "open" | "merged";

export interface LatticePullRequestListProps {
  workspaceRoot: string;
  projectId: ProjectId;
  /** The open list, loaded by the inbox (its query also feeds the detail's send targets). */
  openList: GitHubInboxListResult | undefined;
  openPending: boolean;
  openError: unknown;
  onRetry: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  onPasteReference: (text: string) => boolean;
  isSelected: (item: GitHubInboxPullRequestItem) => boolean;
  onSelect: (item: GitHubInboxPullRequestItem) => void;
  loading: ReactNode;
}

function matchesQuery(item: GitHubInboxPullRequestItem, query: string): boolean {
  if (!query) return true;
  const number = query.replace(/^#/, "");
  return (
    String(item.number) === number ||
    item.title.toLowerCase().includes(query) ||
    item.headBranch.toLowerCase().includes(query) ||
    (item.author?.login.toLowerCase().includes(query) ?? false) ||
    (item.author?.name?.toLowerCase().includes(query) ?? false)
  );
}

/** "Mina" from "Mina Park", else the login. */
function shortName(item: GitHubInboxPullRequestItem): string | null {
  const name = item.author?.name?.trim();
  if (name) return name.split(/\s+/)[0] ?? name;
  return item.author?.login ?? null;
}

export function LatticePullRequestList(props: LatticePullRequestListProps) {
  const { i18n } = useLingui();
  const normalizedQuery = props.query.trim().toLowerCase();
  const closedQuery = useQuery({
    ...githubInboxListQueryOptions("closed", "updated", { projectId: props.projectId }),
    enabled: props.openList !== undefined,
  });
  const branchesQuery = useQuery(gitBranchesQueryOptions(props.workspaceRoot));

  const viewer = props.openList?.viewer?.toLowerCase() ?? null;
  const openItems = (props.openList?.items ?? []).filter(
    (item): item is GitHubInboxPullRequestItem =>
      item.kind === "pullRequest" && item.state === "open",
  );
  const mergedSince = Date.now() - RECENTLY_MERGED_DAYS * 86_400_000;
  const mergedItems = (closedQuery.data?.items ?? [])
    .filter(
      (item): item is GitHubInboxPullRequestItem =>
        item.kind === "pullRequest" &&
        item.state === "merged" &&
        Date.parse(item.updatedAt) >= mergedSince,
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, RECENTLY_MERGED_LIMIT);

  const isYours = (item: GitHubInboxPullRequestItem) =>
    item.viewerInvolvement?.authored === true ||
    (viewer !== null && item.author?.login.toLowerCase() === viewer);
  const shown = (items: GitHubInboxPullRequestItem[]) =>
    items.filter((item) => matchesQuery(item, normalizedQuery));
  const groups: Array<{ key: GroupKey; label: string; items: GitHubInboxPullRequestItem[] }> = [
    {
      key: "review",
      label: i18n._("Needs your review"),
      items: shown(openItems.filter((item) => item.viewerReviewRequested && !isYours(item))),
    },
    { key: "yours", label: i18n._("Yours"), items: shown(openItems.filter(isYours)) },
    {
      key: "open",
      label: i18n._("Also open"),
      items: shown(openItems.filter((item) => !item.viewerReviewRequested && !isYours(item))),
    },
    { key: "merged", label: i18n._("Recently merged"), items: shown(mergedItems) },
  ];
  const visibleCount = groups.reduce((sum, group) => sum + group.items.length, 0);

  const listErrors = (props.openList?.errors ?? []).filter(
    (error) => error.reason !== "rate-limited" || !error.showingCachedData,
  );
  const notOnGitHub =
    props.openList !== undefined &&
    props.openList.repositoryBatches.length === 0 &&
    props.openList.errors.length === 0;
  const unavailable = isPullRequestsUnavailableError(props.openError) ? props.openError : null;
  const ghBlocked =
    unavailable?.reason === "gh-not-installed" || unavailable?.reason === "gh-not-authenticated";
  // A folder that is not a Git repository fails the inbox's remote inventory with Git's own
  // "not a git repository"; the branch probe says so plainly, so it decides the state instead.
  const repositoryProbePending = branchesQuery.isPending;
  const notARepository = branchesQuery.data?.isRepo === false;

  return (
    <div className="lattice-git lattice-prs" data-lattice-pull-requests="">
      <GitActionsControl
        gitCwd={props.workspaceRoot}
        activeThreadId={null}
        variant="lattice"
        latticeSourceControl
        renderLattice={(actions) => {
          const branch = actions.status?.branch ?? null;
          const canOpen =
            actions.createPullRequest.available && !actions.createPullRequest.opensExisting;
          return (
            <>
              {!ghBlocked && !notOnGitHub && !notARepository ? (
                <div className="lattice-prs-head">
                  <label className="lattice-prs-search">
                    <SearchIcon aria-hidden className="size-3.5" />
                    <input
                      type="search"
                      aria-label={i18n._("Search pull requests")}
                      placeholder={i18n._("Search or paste a pull request link")}
                      value={props.query}
                      onChange={(event) => props.onQueryChange(event.target.value)}
                      onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
                        const text = event.clipboardData.getData("text");
                        if (props.onPasteReference(text)) event.preventDefault();
                      }}
                    />
                    {props.query ? (
                      <button
                        type="button"
                        className="lattice-prs-clear"
                        aria-label={i18n._("Clear search")}
                        onClick={() => props.onQueryChange("")}
                      >
                        <XIcon aria-hidden className="size-3" />
                      </button>
                    ) : null}
                  </label>
                  {canOpen ? (
                    <button
                      type="button"
                      className="lattice-git-button lattice-git-tinted lattice-prs-new"
                      title={i18n._("Open a pull request from {branch}", { branch: branch ?? "" })}
                      onClick={actions.createPullRequest.open}
                    >
                      <CreatePullRequestIcon aria-hidden className="size-3.5" />
                      <span className="lattice-git-button-label">{i18n._("New")}</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="lattice-git-scroll lattice-prs-scroll">
                {props.openPending || repositoryProbePending ? (
                  props.loading
                ) : notARepository ? (
                  <PullRequestsEmpty
                    title={i18n._("Pull requests need a Git repository")}
                    description={i18n._(
                      "Start version control for this project, then publish it to GitHub to review changes with your co-authors",
                    )}
                    action={<LatticeGitInitializeButton cwd={props.workspaceRoot} />}
                  />
                ) : unavailable && ghBlocked ? (
                  <GitHubCliState
                    notInstalled={unavailable.reason === "gh-not-installed"}
                    onRetry={props.onRetry}
                  />
                ) : props.openError && !props.openList ? (
                  <PullRequestsEmpty
                    title={i18n._("Pull requests could not be loaded")}
                    description={
                      <>
                        <span>
                          {unavailable?.reason === "rate-limited"
                            ? i18n._(
                                "GitHub is limiting requests for now. Try again in a few minutes",
                              )
                            : i18n._(
                                "Lattice could not reach GitHub. Check your connection and try again",
                              )}
                        </span>
                        <LatticeErrorDetails
                          detail={props.openError instanceof Error ? props.openError.message : null}
                        />
                      </>
                    }
                    action={
                      <button type="button" className="lattice-git-button" onClick={props.onRetry}>
                        {i18n._("Try again")}
                      </button>
                    }
                  />
                ) : notOnGitHub ? (
                  <NotOnGitHubState
                    workspaceRoot={props.workspaceRoot}
                    hasOriginRemote={branchesQuery.data?.hasOriginRemote ?? false}
                  />
                ) : visibleCount === 0 && normalizedQuery ? (
                  <p className="lattice-prs-note">
                    {i18n._("No pull requests match “{query}”", { query: props.query.trim() })}
                  </p>
                ) : openItems.length === 0 ? (
                  <>
                    <PullRequestsEmpty
                      title={i18n._("No open pull requests")}
                      description={
                        canOpen && branch
                          ? i18n._(
                              "{branch} has commits that are not on {base}. Open a pull request to ask your co-authors to review them",
                              { branch, base: actions.defaultBranchName ?? "main" },
                            )
                          : i18n._(
                              "When you or a co-author opens a pull request on GitHub, it shows up here",
                            )
                      }
                      action={
                        canOpen && branch ? (
                          <button
                            type="button"
                            className="lattice-git-button lattice-git-tinted"
                            onClick={actions.createPullRequest.open}
                          >
                            <CreatePullRequestIcon aria-hidden className="size-3.5" />
                            <span className="lattice-git-button-label">
                              {i18n._("Open a pull request from {branch}", { branch })}
                            </span>
                          </button>
                        ) : null
                      }
                    />
                    {groups[3]!.items.length > 0 ? (
                      <PullRequestGroup
                        label={groups[3]!.label}
                        items={groups[3]!.items}
                        foldable
                        isSelected={props.isSelected}
                        onSelect={props.onSelect}
                      />
                    ) : null}
                  </>
                ) : (
                  groups.map((group) =>
                    group.items.length > 0 ? (
                      <PullRequestGroup
                        key={group.key}
                        label={group.label}
                        items={group.items}
                        isSelected={props.isSelected}
                        onSelect={props.onSelect}
                      />
                    ) : null,
                  )
                )}
                {notARepository
                  ? null
                  : listErrors.map((error) => (
                      <div
                        key={`${error.repository ?? ""}:${error.reason}`}
                        className="lattice-prs-warning"
                        role="status"
                      >
                        <CircleAlertIcon aria-hidden className="size-3.5" />
                        <div className="lattice-prs-warning-body">
                          <span>
                            {error.reason === "rate-limited"
                              ? i18n._(
                                  "GitHub is limiting requests for now. Lattice will try again shortly",
                                )
                              : error.repository
                                ? i18n._("Could not read {repository} on GitHub", {
                                    repository: error.repository,
                                  })
                                : i18n._("Could not read this project’s Git remotes")}
                          </span>
                          <LatticeErrorDetails detail={error.message} />
                        </div>
                      </div>
                    ))}
              </div>
            </>
          );
        }}
      />
    </div>
  );
}

function PullRequestGroup(props: {
  label: string;
  items: GitHubInboxPullRequestItem[];
  foldable?: boolean;
  isSelected: (item: GitHubInboxPullRequestItem) => boolean;
  onSelect: (item: GitHubInboxPullRequestItem) => void;
}) {
  const [open, setOpen] = useState(!props.foldable);
  return (
    <section className="lattice-git-section lattice-prs-group">
      {props.foldable ? (
        <button
          type="button"
          className="lattice-prs-fold"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDownIcon aria-hidden className="lattice-prs-fold-chevron size-3.5" />
          <span>{props.label}</span>
          <span className="lattice-git-count">{props.items.length}</span>
        </button>
      ) : (
        <header className="lattice-git-section-head">
          <h3>{props.label}</h3>
          <span className="lattice-git-count">{props.items.length}</span>
        </header>
      )}
      {open ? (
        <ul>
          {props.items.map((item) => (
            <li key={`${item.repository}#${item.number}`}>
              <PullRequestRow
                item={item}
                selected={props.isSelected(item)}
                onSelect={() => props.onSelect(item)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PullRequestRow(props: {
  item: GitHubInboxPullRequestItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const { i18n } = useLingui();
  const { item } = props;
  const who = shortName(item);
  const checks = item.checksState;
  return (
    <button
      type="button"
      className="lattice-prs-row"
      data-selected={props.selected || undefined}
      aria-current={props.selected || undefined}
      data-pull-request-row=""
      data-project-id={item.projectId}
      data-repository={item.repository}
      data-pull-request-number={item.number}
      onClick={props.onSelect}
    >
      <PullRequestStateGlyph
        state={item.state}
        isDraft={item.isDraft}
        mergeability={item.mergeability}
        className="lattice-prs-glyph"
      />
      <span className="lattice-prs-main">
        <span className="lattice-prs-title">{item.title}</span>
        <span className="lattice-prs-meta">
          <span className="lattice-prs-number">#{item.number}</span>
          <span className="lattice-prs-branches" title={`${item.headBranch} → ${item.baseBranch}`}>
            {item.headBranch} → {item.baseBranch}
          </span>
          {who ? <span className="lattice-prs-who">{who}</span> : null}
          <time className="lattice-prs-age" dateTime={item.updatedAt}>
            {formatRelativeTime(item.updatedAt)}
          </time>
        </span>
      </span>
      <span className="lattice-prs-side">
        {checks ? (
          <span
            className="lattice-prs-checks"
            data-state={checks}
            title={
              checks === "success"
                ? i18n._("Checks passed")
                : checks === "failure"
                  ? i18n._("Checks failed")
                  : i18n._("Checks running")
            }
          >
            {checks === "success" ? (
              <CheckIcon aria-hidden className="size-3" />
            ) : checks === "failure" ? (
              <XIcon aria-hidden className="size-3" />
            ) : (
              <span aria-hidden className="lattice-prs-checks-dot" />
            )}
          </span>
        ) : null}
        {(item.commentCount ?? 0) > 0 ? (
          <span
            className="lattice-prs-comments"
            title={i18n._("{count, plural, one {# comment} other {# comments}}", {
              count: item.commentCount,
            })}
          >
            <MessageCircleIcon aria-hidden className="size-3" />
            {item.commentCount}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function PullRequestsEmpty(props: { title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <div className="lattice-git-empty" role="status">
      <ResearchArt drawing={ROUTING_ENVELOPE} />
      <p className="lattice-git-empty-title">{props.title}</p>
      <div className="lattice-git-empty-description">{props.description}</div>
      {props.action ? <div className="lattice-git-empty-actions">{props.action}</div> : null}
    </div>
  );
}

function NotOnGitHubState(props: { workspaceRoot: string; hasOriginRemote: boolean }) {
  const { i18n } = useLingui();
  const [setup, setSetup] = useState<"create" | "connect" | null>(null);
  return (
    <>
      <PullRequestsEmpty
        title={i18n._("This project is not on GitHub")}
        description={
          props.hasOriginRemote
            ? i18n._(
                "Pull requests need a GitHub repository, and this project’s remote is somewhere else",
              )
            : i18n._(
                "Pull requests need a GitHub repository. Publish the project privately and invite your co-authors",
              )
        }
        action={
          props.hasOriginRemote ? null : (
            <>
              <button
                type="button"
                className="lattice-git-button lattice-git-tinted"
                onClick={() => setSetup("create")}
              >
                <GitHubIcon aria-hidden className="size-3.5" />
                <span className="lattice-git-button-label">{i18n._("Publish to GitHub")}</span>
              </button>
              <button
                type="button"
                className="lattice-git-button"
                onClick={() => setSetup("connect")}
              >
                <LinkIcon aria-hidden className="size-3.5" />
                <span className="lattice-git-button-label">{i18n._("Connect existing")}</span>
              </button>
            </>
          )
        }
      />
      {setup ? (
        <GitHubRepositorySetupDialog
          key={setup}
          cwd={props.workspaceRoot}
          mode={setup}
          open
          onOpenChange={(open) => {
            if (!open) setSetup(null);
          }}
        />
      ) : null}
    </>
  );
}

/** The GitHub CLI is missing or signed out: the one command that fixes it, and Check again. */
function GitHubCliState(props: { notInstalled: boolean; onRetry: () => void }) {
  const { i18n } = useLingui();
  const command = props.notInstalled ? "brew install gh" : "gh auth login";
  const [copied, setCopied] = useState(false);
  return (
    <PullRequestsEmpty
      title={
        props.notInstalled
          ? i18n._("Install the GitHub CLI to see pull requests")
          : i18n._("Sign in to GitHub to see pull requests")
      }
      description={
        <>
          <span>
            {props.notInstalled
              ? i18n._("Lattice reads pull requests through the GitHub CLI. Install it in Terminal")
              : i18n._(
                  "Lattice reads pull requests through the GitHub CLI. Run this once in Terminal",
                )}
          </span>
          <button
            type="button"
            className="lattice-prs-command"
            title={i18n._("Copy to clipboard")}
            onClick={() => {
              void copyTextToClipboard(command).then(
                () => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                },
                () => toastManager.add({ type: "error", title: i18n._("Could not copy command") }),
              );
            }}
          >
            <code>{command}</code>
            {copied ? (
              <CheckIcon aria-hidden className="size-3" />
            ) : (
              <CopyIcon aria-hidden className="size-3" />
            )}
          </button>
        </>
      }
      action={
        <>
          {props.notInstalled ? (
            <button
              type="button"
              className="lattice-git-button"
              onClick={() => void ensureNativeApi().shell.openExternal("https://cli.github.com/")}
            >
              {i18n._("Install instructions")}
            </button>
          ) : null}
          <button type="button" className={cn("lattice-git-button")} onClick={props.onRetry}>
            {i18n._("Check again")}
          </button>
        </>
      }
    />
  );
}

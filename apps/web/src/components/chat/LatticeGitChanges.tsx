// FILE: LatticeGitChanges.tsx
// Purpose: Lattice's embedded Changes view (`/source-control`): the branch and its sync state on
//          one line, the commit message composed in the panel, files staged by checkbox and read
//          as prose when opened, and a clean state that says what is still left to do.
// Layer: Embedded Git presentation (Lattice host only; standalone Synara keeps GitPanel's layout)
// Depends on: GitActionsControl's `lattice` variant for every runner, confirmation, toast and
//             dialog, so commit, push, pull and Create PR behave exactly as on other surfaces.

import { type FileDiffMetadata } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useLingui } from "@lingui/react";
import { type KeyboardEvent, type ReactElement, type ReactNode, useId, useState } from "react";

import { formatRelativeTime } from "~/lib/relativeTime";
import { gitRecentCommitsQueryOptions } from "~/lib/gitReactQuery";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  DelegateIcon,
  EllipsisIcon,
  LoaderCircleIcon,
  PushIcon,
  RefreshCwIcon,
} from "~/lib/icons";
import { isProsePath, readProseChanges, splitPatchByFile } from "~/lib/proseDiff";
import {
  resolveFileDiffPath,
  splitRepoRelativePath,
  summarizeFileDiffStats,
} from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { Alert } from "../ui/alert";
import { Checkbox } from "../ui/checkbox";
import { IconButton } from "../ui/icon-button";
import { Menu, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import { BranchToolbarBranchSelector } from "../BranchToolbarBranchSelector";
import GitActionsControl, { type LatticeGitActions } from "../GitActionsControl";
import { ResearchArt } from "../researchArt/ResearchArt";
import { DATED_DRAFTS } from "../researchArt/datedDrafts";
import { FileEntryIcon } from "./FileEntryIcon";
import { SingleFileDiffBody } from "./FileDiffView";
import { ProseChangeList } from "./LatticeProseChanges";

const PUSH_AFTER_COMMIT_KEY = "synara:lattice-git:push-after-commit";

function readPushAfterCommit(): boolean {
  try {
    return window.localStorage.getItem(PUSH_AFTER_COMMIT_KEY) !== "false";
  } catch {
    return true;
  }
}

function writePushAfterCommit(value: boolean) {
  try {
    window.localStorage.setItem(PUSH_AFTER_COMMIT_KEY, value ? "true" : "false");
  } catch {
    // A blocked store only forgets the choice.
  }
}

// `git.status` names the upstream's branch, not its remote; Lattice projects push to origin.
const UPSTREAM_REMOTE = "origin";

type FileStatus = "A" | "M" | "D" | "R";

function statusOf(fileDiff: FileDiffMetadata): FileStatus {
  if (fileDiff.type === "new") return "A";
  if (fileDiff.type === "deleted") return "D";
  if (fileDiff.type === "rename-pure" || fileDiff.type === "rename-changed") return "R";
  return "M";
}

export interface LatticeGitChangesProps {
  cwd: string;
  theme: "light" | "dark";
  stagedFiles: FileDiffMetadata[];
  unstagedFiles: FileDiffMetadata[];
  stagedPatch: string;
  unstagedPatch: string;
  isLoading: boolean;
  error: string | null;
  mutating: boolean;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  refreshing: boolean;
  onRefresh: () => void;
  /** The Publish to GitHub card, shown while the repository has no `origin` remote. */
  remoteSetup: ReactNode;
  loadingRows: ReactNode;
}

export function LatticeGitChanges(props: LatticeGitChangesProps) {
  return (
    <div className="lattice-git lattice-source-control" data-lattice-git-changes="">
      <GitActionsControl
        gitCwd={props.cwd}
        activeThreadId={null}
        variant="lattice"
        latticeSourceControl
        renderLattice={(actions) => <LatticeGitChangesBody {...props} actions={actions} />}
      />
    </div>
  );
}

function LatticeGitChangesBody(props: LatticeGitChangesProps & { actions: LatticeGitActions }) {
  const { actions } = props;
  const hasChanges = props.stagedFiles.length > 0 || props.unstagedFiles.length > 0;
  const showClean = !props.error && !props.isLoading && !hasChanges;
  return (
    <>
      <LatticeBranchBar
        cwd={props.cwd}
        actions={actions}
        refreshing={props.refreshing}
        onRefresh={props.onRefresh}
      />
      <div className="lattice-git-scroll" data-lattice-git-scroll="">
        {props.remoteSetup}
        {props.error ? (
          <Alert variant="error" size="sm" className="text-destructive">
            {props.error}
          </Alert>
        ) : null}
        {!props.error && props.isLoading && !hasChanges ? props.loadingRows : null}
        {hasChanges ? (
          <>
            <LatticeCommitComposer
              actions={actions}
              stagedFiles={props.stagedFiles}
              unstagedFiles={props.unstagedFiles}
            />
            {props.stagedFiles.length > 0 ? (
              <LatticeFileSection
                section="staged"
                files={props.stagedFiles}
                patch={props.stagedPatch}
                theme={props.theme}
                mutating={props.mutating}
                onToggle={props.onUnstage}
              />
            ) : null}
            {props.unstagedFiles.length > 0 ? (
              <LatticeFileSection
                section="unstaged"
                files={props.unstagedFiles}
                patch={props.unstagedPatch}
                theme={props.theme}
                mutating={props.mutating}
                onToggle={props.onStage}
              />
            ) : null}
          </>
        ) : null}
        {showClean ? <LatticeCleanState cwd={props.cwd} actions={actions} /> : null}
      </div>
    </>
  );
}

/** Branch picker, where the branch stands against its remote, and Refresh, on one line. */
function LatticeBranchBar(props: {
  cwd: string;
  actions: LatticeGitActions;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { i18n } = useLingui();
  return (
    <div className="lattice-git-branchbar" data-lattice-git-branchbar="">
      <div className="lattice-git-branch">
        <BranchToolbarBranchSelector
          activeProjectCwd={props.cwd}
          activeThreadBranch={null}
          activeWorktreePath={null}
          branchCwd={props.cwd}
          effectiveEnvMode="local"
          envLocked
          hasServerThread={false}
          isThreadSettled
          onSetThreadWorkspace={() => undefined}
          variant="panel"
          latticeSourceControl
        />
      </div>
      <LatticeSyncState actions={props.actions} />
      <LatticeGitMenu
        actions={props.actions}
        align="end"
        trigger={
          <button
            type="button"
            className="lattice-git-icon-button lattice-git-menu-button"
            aria-label={i18n._("More Git actions")}
            title={i18n._("More Git actions")}
            disabled={props.actions.statusPending}
          />
        }
      >
        <EllipsisIcon aria-hidden className="size-3.5" />
      </LatticeGitMenu>
      <IconButton
        size="icon-xs"
        variant="ghost"
        className="lattice-git-icon-button"
        label={i18n._("Refresh changes")}
        tooltip={i18n._("Refresh changes")}
        disabled={props.refreshing}
        aria-busy={props.refreshing || undefined}
        onClick={props.onRefresh}
      >
        <RefreshCwIcon className={cn("size-3.5", props.refreshing && "animate-spin")} />
      </IconButton>
    </div>
  );
}

/** "Push 2", "Pull 3", "Publish", or a quiet "Up to date": the one thing the branch needs next. */
function LatticeSyncState({ actions }: { actions: LatticeGitActions }) {
  const { i18n } = useLingui();
  const status = actions.status;
  if (!status || status.branch === null) return null;
  const remote = UPSTREAM_REMOTE;
  if (!status.hasUpstream) {
    if (!actions.hasOriginRemote) {
      return (
        <span className="lattice-git-sync lattice-git-sync-quiet">{i18n._("Local only")}</span>
      );
    }
    return (
      <button
        type="button"
        className="lattice-git-sync"
        disabled={actions.isBusy}
        title={i18n._("Publish {branch} to {remote}", { branch: status.branch, remote })}
        onClick={actions.push}
      >
        <ArrowUpIcon aria-hidden className="size-3.5" />
        <span className="lattice-git-sync-label">{i18n._("Publish")}</span>
      </button>
    );
  }
  if (status.aheadCount > 0 && status.behindCount > 0) {
    return (
      <span
        className="lattice-git-sync lattice-git-sync-quiet lattice-git-sync-warning"
        title={i18n._("Branch has diverged from upstream. Rebase/merge first.")}
      >
        {i18n._("Diverged")}
      </span>
    );
  }
  if (status.behindCount > 0) {
    return (
      <button
        type="button"
        className="lattice-git-sync"
        disabled={actions.isBusy}
        title={i18n._(
          "{count, plural, one {Pull # commit from {remote}} other {Pull # commits from {remote}}}",
          { count: status.behindCount, remote },
        )}
        onClick={actions.pull}
      >
        <ArrowDownIcon aria-hidden className="size-3.5" />
        <span className="lattice-git-sync-label">
          {i18n._("Pull {count}", { count: status.behindCount })}
        </span>
      </button>
    );
  }
  if (status.aheadCount > 0) {
    return (
      <button
        type="button"
        className="lattice-git-sync"
        disabled={actions.isBusy}
        title={i18n._(
          "{count, plural, one {Push # commit to {remote}} other {Push # commits to {remote}}}",
          { count: status.aheadCount, remote },
        )}
        onClick={actions.push}
      >
        <ArrowUpIcon aria-hidden className="size-3.5" />
        <span className="lattice-git-sync-label">
          {i18n._("Push {count}", { count: status.aheadCount })}
        </span>
        <span className="lattice-git-sync-sub">{remote}</span>
      </button>
    );
  }
  return (
    <span className="lattice-git-sync lattice-git-sync-quiet" title={remote}>
      <CheckIcon aria-hidden className="lattice-git-sync-check size-3.5" />
      <span className="lattice-git-sync-label">{i18n._("Up to date")}</span>
    </span>
  );
}

/**
 * The commit message comes first; the button says what it commits. With files staged it commits
 * those, otherwise every change, as `git commit -a` would.
 */
function LatticeCommitComposer(props: {
  actions: LatticeGitActions;
  stagedFiles: FileDiffMetadata[];
  unstagedFiles: FileDiffMetadata[];
}) {
  const { i18n } = useLingui();
  const { actions } = props;
  const descriptionId = useId();
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [pushAfter, setPushAfter] = useState(readPushAfterCommit);
  const [writing, setWriting] = useState(false);

  const stagedPaths = props.stagedFiles.map((file) => resolveFileDiffPath(file));
  const allPaths = [
    ...new Set([...stagedPaths, ...props.unstagedFiles.map((file) => resolveFileDiffPath(file))]),
  ];
  const commitPaths = stagedPaths.length > 0 ? stagedPaths : null;
  const fileCount = commitPaths ? commitPaths.length : allPaths.length;
  // Until status answers, assume a push is possible so the button's label does not flip.
  const canPush =
    actions.statusPending || (actions.hasOriginRemote && actions.status?.branch != null);
  const push = canPush && pushAfter;
  const disabled = actions.isBusy || actions.statusPending || fileCount === 0;
  const message = [summary.trim(), description.trim()].filter(Boolean).join("\n\n");

  const commit = () => {
    if (disabled) return;
    actions.commit({
      message: message || null,
      filePaths: commitPaths,
      push,
      onCommitted: () => {
        setSummary("");
        setDescription("");
      },
    });
  };

  const writeMessage = async () => {
    if (writing) return;
    setWriting(true);
    try {
      const drafted = await actions.writeCommitMessage(commitPaths);
      setSummary(drafted.subject);
      setDescription(drafted.body);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: i18n._("Could not write a commit message"),
        description: error instanceof Error ? error.message : i18n._("An error occurred."),
      });
    } finally {
      setWriting(false);
    }
  };

  const submitOnShortcut = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commit();
    }
  };

  const label = push
    ? i18n._("{count, plural, one {Commit & push # file} other {Commit & push # files}}", {
        count: fileCount,
      })
    : i18n._("{count, plural, one {Commit # file} other {Commit # files}}", { count: fileCount });

  return (
    <form
      className="lattice-git-composer"
      data-lattice-git-composer=""
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
    >
      <div className="lattice-git-summary">
        <input
          aria-label={i18n._("Commit message")}
          aria-describedby={descriptionId}
          maxLength={300}
          placeholder={i18n._("Message (leave empty to generate)")}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          onKeyDown={submitOnShortcut}
        />
        <IconButton
          size="icon-xs"
          variant="ghost"
          className="lattice-git-write"
          label={i18n._("Write the message for me")}
          tooltip={i18n._("Write the message for me")}
          disabled={writing || fileCount === 0}
          aria-busy={writing || undefined}
          onClick={() => void writeMessage()}
        >
          {writing ? (
            <LoaderCircleIcon className="size-3.5 animate-spin" />
          ) : (
            <DelegateIcon className="size-3.5" />
          )}
        </IconButton>
      </div>
      <textarea
        id={descriptionId}
        aria-label={i18n._("Description")}
        maxLength={9_000}
        rows={2}
        placeholder={i18n._("Description (optional)")}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        onKeyDown={submitOnShortcut}
      />
      <div className="lattice-git-commit-row">
        <span className="lattice-git-split">
          <button
            type="submit"
            className="lattice-git-button lattice-git-primary"
            disabled={disabled}
            aria-keyshortcuts="Meta+Enter Control+Enter"
          >
            <span className="lattice-git-button-label">{label}</span>
            <kbd className="lattice-git-kbd" aria-hidden>
              ⌘↩
            </kbd>
          </button>
          <LatticeGitMenu
            actions={actions}
            align="start"
            trigger={
              <button
                type="button"
                className="lattice-git-button lattice-git-primary lattice-git-caret"
                aria-label={i18n._("More ways to commit")}
                disabled={actions.statusPending}
              />
            }
          >
            <ChevronDownIcon aria-hidden className="size-3.5" />
          </LatticeGitMenu>
        </span>
        {canPush ? (
          <label className="lattice-git-push">
            <Checkbox
              checked={pushAfter}
              onCheckedChange={(checked) => {
                setPushAfter(checked === true);
                writePushAfterCommit(checked === true);
              }}
            />
            <span>{i18n._("Push after committing")}</span>
          </label>
        ) : null}
      </div>
    </form>
  );
}

/** The Git actions menu (commit with the dialog, push, pull, Create PR, Create Branch). */
function LatticeGitMenu(props: {
  actions: LatticeGitActions;
  align: "start" | "end";
  trigger: ReactElement;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) props.actions.refreshMenuAvailability();
      }}
    >
      <MenuTrigger render={props.trigger}>{props.children}</MenuTrigger>
      <ComposerPickerMenuPopup
        align={props.align}
        side="bottom"
        className="lattice-source-control-popup w-60 min-w-60"
      >
        {props.actions.menuContent}
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

function LatticeFileSection(props: {
  section: "staged" | "unstaged";
  files: FileDiffMetadata[];
  patch: string;
  theme: "light" | "dark";
  mutating: boolean;
  onToggle: (paths: string[]) => void;
}) {
  const { i18n } = useLingui();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const filePatches = splitPatchByFile(props.patch);
  const staged = props.section === "staged";
  const paths = props.files.map((file) => resolveFileDiffPath(file));
  return (
    <section className="lattice-git-section" data-lattice-git-section={props.section}>
      <header className="lattice-git-section-head">
        <h3>{staged ? i18n._("Staged") : i18n._("Not staged")}</h3>
        <span className="lattice-git-count">{props.files.length}</span>
        <button
          type="button"
          className="lattice-git-link"
          disabled={props.mutating}
          onClick={() => props.onToggle(paths)}
        >
          {staged ? i18n._("Unstage all") : i18n._("Stage all")}
        </button>
      </header>
      <ul>
        {props.files.map((file) => {
          const path = resolveFileDiffPath(file);
          return (
            <LatticeFileRow
              key={path}
              fileDiff={file}
              path={path}
              staged={staged}
              open={openPath === path}
              filePatch={filePatches.get(path) ?? ""}
              theme={props.theme}
              mutating={props.mutating}
              onToggleOpen={() => setOpenPath((current) => (current === path ? null : path))}
              onToggleStaged={() => props.onToggle([path])}
            />
          );
        })}
      </ul>
    </section>
  );
}

function LatticeFileRow(props: {
  fileDiff: FileDiffMetadata;
  path: string;
  staged: boolean;
  open: boolean;
  filePatch: string;
  theme: "light" | "dark";
  mutating: boolean;
  onToggleOpen: () => void;
  onToggleStaged: () => void;
}) {
  const { i18n } = useLingui();
  const { dir, name } = splitRepoRelativePath(props.path);
  const stat = summarizeFileDiffStats([props.fileDiff]);
  const status = statusOf(props.fileDiff);
  const statusLabel =
    status === "A"
      ? i18n._("Added")
      : status === "D"
        ? i18n._("Deleted")
        : status === "R"
          ? i18n._("Renamed")
          : i18n._("Modified");
  return (
    <li className="lattice-git-file" data-open={props.open || undefined}>
      <div className="lattice-git-file-row">
        <Checkbox
          checked={props.staged}
          disabled={props.mutating}
          aria-label={
            props.staged
              ? i18n._("Unstage {path}", { path: props.path })
              : i18n._("Stage {path}", { path: props.path })
          }
          onCheckedChange={props.onToggleStaged}
        />
        <button
          type="button"
          className="lattice-git-file-name"
          title={props.path}
          aria-expanded={props.open}
          onClick={props.onToggleOpen}
        >
          <FileEntryIcon
            pathValue={props.path}
            kind="file"
            theme={props.theme}
            className="size-4"
          />
          <span>
            {dir ? <span className="lattice-git-file-dir">{dir}</span> : null}
            {name}
          </span>
        </button>
        <span className="lattice-git-status" data-status={status} title={statusLabel}>
          <span aria-hidden>{status}</span>
          <span className="sr-only">{statusLabel}</span>
        </span>
        <span className="lattice-git-stat">
          {stat.additions > 0 ? <span data-kind="add">+{stat.additions}</span> : null}
          {stat.deletions > 0 ? <span data-kind="del">−{stat.deletions}</span> : null}
        </span>
      </div>
      {props.open ? (
        <LatticeFileChange
          fileDiff={props.fileDiff}
          path={props.path}
          filePatch={props.filePatch}
          theme={props.theme}
        />
      ) : null}
    </li>
  );
}

/** A paper's change read as sentences; anything else in the usual code diff. */
function LatticeFileChange(props: {
  fileDiff: FileDiffMetadata;
  path: string;
  filePatch: string;
  theme: "light" | "dark";
}) {
  const { i18n } = useLingui();
  if (isProsePath(props.path) && props.filePatch) {
    const { changes, truncated } = readProseChanges(props.filePatch);
    if (changes.length === 0) {
      return (
        <p className="lattice-git-change-note">{i18n._("Only spacing or line breaks changed.")}</p>
      );
    }
    return (
      <div className="lattice-git-change">
        <ProseChangeList changes={changes} />
        {truncated ? (
          <p className="lattice-git-change-note">
            {i18n._("Showing the first {count} changed lines.", { count: changes.length })}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="lattice-git-change lattice-git-change-code diff-render-file">
      <SingleFileDiffBody fileDiff={props.fileDiff} theme={props.theme} />
    </div>
  );
}

/** Nothing to commit: say so with the drawing, then what is still left (a push or a pull). */
function LatticeCleanState(props: { cwd: string; actions: LatticeGitActions }) {
  const { i18n } = useLingui();
  const { actions } = props;
  const status = actions.status;
  const remote = UPSTREAM_REMOTE;
  const lastCommitQuery = useQuery(gitRecentCommitsQueryOptions({ cwd: props.cwd, limit: 1 }));
  const lastCommit = lastCommitQuery.data?.commits[0] ?? null;

  let description: string = i18n._("Edits you make show up here, ready to commit");
  let action: ReactNode = null;
  if (status && status.branch !== null) {
    if (status.hasUpstream && status.behindCount > 0 && status.aheadCount === 0) {
      description = i18n._(
        "{count, plural, one {# new commit is on {remote}. Pull it to bring your copy up to date} other {# new commits are on {remote}. Pull them to bring your copy up to date}}",
        { count: status.behindCount, remote },
      );
      action = (
        <button
          type="button"
          className="lattice-git-button lattice-git-tinted"
          disabled={actions.isBusy}
          onClick={actions.pull}
        >
          <ArrowDownIcon aria-hidden className="size-3.5" />
          {i18n._("{count, plural, one {Pull # commit} other {Pull # commits}}", {
            count: status.behindCount,
          })}
        </button>
      );
    } else if (status.hasUpstream && status.aheadCount > 0 && status.behindCount === 0) {
      description = i18n._(
        "{count, plural, one {# commit is waiting to go to {remote}. Push it when you are ready to share it} other {# commits are waiting to go to {remote}. Push them when you are ready to share them}}",
        { count: status.aheadCount, remote },
      );
      action = (
        <button
          type="button"
          className="lattice-git-button lattice-git-tinted"
          disabled={actions.isBusy}
          onClick={actions.push}
        >
          <PushIcon aria-hidden className="size-3.5" />
          {i18n._("{count, plural, one {Push # commit} other {Push # commits}}", {
            count: status.aheadCount,
          })}
        </button>
      );
    } else if (status.hasUpstream && status.aheadCount > 0) {
      description = i18n._("Branch has diverged from upstream. Rebase/merge first.");
    } else if (!status.hasUpstream && actions.hasOriginRemote) {
      description = i18n._("{branch} is not on {remote} yet. Publish it to share your commits", {
        branch: status.branch,
        remote,
      });
      action = (
        <button
          type="button"
          className="lattice-git-button lattice-git-tinted"
          disabled={actions.isBusy}
          onClick={actions.push}
        >
          <PushIcon aria-hidden className="size-3.5" />
          {i18n._("Publish {branch}", { branch: status.branch })}
        </button>
      );
    }
  }

  return (
    <div className="lattice-git-clean" data-lattice-git-clean="">
      <div className="lattice-git-empty" role="status">
        <ResearchArt drawing={DATED_DRAFTS} />
        <p className="lattice-git-empty-title">{i18n._("Everything is committed")}</p>
        <p className="lattice-git-empty-description">{description}</p>
        {action ? <div className="lattice-git-empty-actions">{action}</div> : null}
      </div>
      {lastCommit ? (
        <footer className="lattice-git-last">
          <span className="lattice-git-last-label">{i18n._("Last commit")}</span>
          <span className="lattice-git-last-title" title={lastCommit.subject}>
            {lastCommit.subject}
          </span>
          <span className="lattice-git-last-meta">
            {lastCommit.authorName ? (
              <span className="lattice-git-last-author">{lastCommit.authorName}</span>
            ) : null}
            <span className="lattice-git-last-sha">{lastCommit.shortSha}</span>
            <time dateTime={lastCommit.committedAt}>
              {formatRelativeTime(lastCommit.committedAt)}
            </time>
          </span>
        </footer>
      ) : null}
    </div>
  );
}

import { t } from "~/i18n";
// FILE: LatticeGitChanges.tsx
// Purpose: Lattice's embedded Changes view (`/source-control`): the branch and its sync state on
//          one line, the commit message composed in the panel, files staged by checkbox and read
//          as prose when opened, and a clean state that says what is still left to do.
// Layer: Embedded Git presentation (Lattice host only; standalone Synara keeps GitPanel's layout)
// Depends on: GitActionsControl's `lattice` variant for every runner, confirmation, toast and
//             dialog, so commit, push, pull and Create PR behave exactly as on other surfaces.

import { type GitChangedFile } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useId,
  useMemo,
  useState,
} from "react";

import { formatRelativeTime } from "~/lib/relativeTime";
import { gitRecentCommitsQueryOptions, gitWorkingTreeDiffQueryOptions } from "~/lib/gitReactQuery";
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
import { getRenderablePatch, splitRepoRelativePath } from "~/lib/diffRendering";
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

const STATUS_LETTERS = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
} as const satisfies Record<GitChangedFile["status"], string>;

/** A rename moves two index entries, so staging, unstaging or committing one names both. */
function actionPathsOf(file: GitChangedFile): string[] {
  return file.previousPath === undefined ? [file.path] : [file.path, file.previousPath];
}

/**
 * One side of the index as `git.readWorkingTreeDiff` returns it. `files` is Git's own list and
 * decides what is shown, staged and committed; `patch` only supplies each file's change, and is
 * capped, so with `truncated` set it can stop inside one file and omit the rest.
 */
export interface LatticeChangeScope {
  files: ReadonlyArray<GitChangedFile>;
  patch: string;
  truncated: boolean;
}

export interface LatticeGitChangesProps {
  cwd: string;
  theme: "light" | "dark";
  staged: LatticeChangeScope;
  unstaged: LatticeChangeScope;
  /** Whether `git.status` sees uncommitted work; the clean state also needs it to agree. */
  statusHasChanges: boolean;
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
  const { actions, staged, unstaged } = props;
  const hasChanges = staged.files.length > 0 || unstaged.files.length > 0;
  // Status and the file lists refresh separately. While status still reports work the lists
  // have not caught up with, keep the loading rows rather than claim everything is committed.
  const listsCatchingUp = !hasChanges && props.statusHasChanges;
  const showClean = !props.error && !props.isLoading && !hasChanges && !listsCatchingUp;
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
        {!props.error && (props.isLoading || listsCatchingUp) && !hasChanges
          ? props.loadingRows
          : null}
        {hasChanges ? (
          <>
            <LatticeCommitComposer
              actions={actions}
              stagedFiles={staged.files}
              unstagedFiles={unstaged.files}
            />
            {staged.files.length > 0 ? (
              <LatticeFileSection
                section="staged"
                scope={staged}
                cwd={props.cwd}
                theme={props.theme}
                mutating={props.mutating}
                onToggle={props.onUnstage}
              />
            ) : null}
            {unstaged.files.length > 0 ? (
              <LatticeFileSection
                section="unstaged"
                scope={unstaged}
                cwd={props.cwd}
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
            aria-label={t("lattice:moreGitActions")}
            title={t("lattice:moreGitActions")}
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
        label={t("git:gitPanel_refreshLabel")}
        tooltip={t("git:gitPanel_refreshLabel")}
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
  const status = actions.status;
  if (!status || status.branch === null) return null;
  const remote = UPSTREAM_REMOTE;
  if (!status.hasUpstream) {
    if (!actions.hasOriginRemote) {
      return (
        <span className="lattice-git-sync lattice-git-sync-quiet">{t("lattice:localOnly")}</span>
      );
    }
    return (
      <button
        type="button"
        className="lattice-git-sync"
        disabled={actions.isBusy}
        title={t("lattice:publishTo", { branch: status.branch, remote })}
        onClick={actions.push}
      >
        <ArrowUpIcon aria-hidden className="size-3.5" />
        <span className="lattice-git-sync-label">{t("lattice:publish")}</span>
      </button>
    );
  }
  if (status.aheadCount > 0 && status.behindCount > 0) {
    return (
      <span
        className="lattice-git-sync lattice-git-sync-quiet lattice-git-sync-warning"
        title={t("lattice:branchHasDivergedFromUpstreamRebaseMerge")}
      >
        {t("lattice:diverged")}
      </span>
    );
  }
  if (status.behindCount > 0) {
    return (
      <button
        type="button"
        className="lattice-git-sync"
        disabled={actions.isBusy}
        title={t("lattice:pullCommitsFrom", { count: status.behindCount, remote })}
        onClick={actions.pull}
      >
        <ArrowDownIcon aria-hidden className="size-3.5" />
        <span className="lattice-git-sync-label">
          {t("lattice:pull", { count: status.behindCount })}
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
        title={t("lattice:pushCommitsTo", { count: status.aheadCount, remote })}
        onClick={actions.push}
      >
        <ArrowUpIcon aria-hidden className="size-3.5" />
        <span className="lattice-git-sync-label">
          {t("lattice:push2", { count: status.aheadCount })}
        </span>
        <span className="lattice-git-sync-sub">{remote}</span>
      </button>
    );
  }
  return (
    <span
      className="lattice-git-sync lattice-git-sync-quiet lattice-git-sync-current"
      title={t("lattice:upToDateWith", { remote })}
    >
      <CheckIcon aria-hidden className="lattice-git-sync-check size-3.5" />
      <span className="lattice-git-sync-label">{t("lattice:upToDate")}</span>
    </span>
  );
}

/**
 * The commit message comes first; the button says what it commits. With files staged it commits
 * those, otherwise every change, as `git commit -a` would.
 */
function LatticeCommitComposer(props: {
  actions: LatticeGitActions;
  stagedFiles: ReadonlyArray<GitChangedFile>;
  unstagedFiles: ReadonlyArray<GitChangedFile>;
}) {
  const { actions } = props;
  const descriptionId = useId();
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [pushAfter, setPushAfter] = useState(readPushAfterCommit);
  const [writing, setWriting] = useState(false);

  const commitPaths =
    props.stagedFiles.length > 0 ? props.stagedFiles.flatMap(actionPathsOf) : null;
  const fileCount = commitPaths ? props.stagedFiles.length : props.unstagedFiles.length;
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
        title: t("lattice:couldNotWriteACommitMessage"),
        description: error instanceof Error ? error.message : t("common:proposedPlan_unknownError"),
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
    ? t("lattice:commitPushFiles", { count: fileCount })
    : t("lattice:commitFiles", { count: fileCount });

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
          aria-label={t("git:commitMessage")}
          aria-describedby={descriptionId}
          maxLength={300}
          placeholder={t("git:messageLeaveEmptyToGenerate")}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          onKeyDown={submitOnShortcut}
        />
        <IconButton
          size="icon-xs"
          variant="ghost"
          className="lattice-git-write"
          label={t("lattice:writeTheMessageForMe")}
          tooltip={t("lattice:writeTheMessageForMe")}
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
        aria-label={t("git:description")}
        maxLength={9_000}
        rows={2}
        placeholder={t("lattice:descriptionOptional")}
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
                aria-label={t("lattice:moreWaysToCommit")}
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
            <span>{t("lattice:pushAfterCommitting")}</span>
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

/**
 * Each file's own patch, keyed by its path. A truncated patch may stop inside its last file, so
 * that file is left out too and, like every file past the cut, loads its change on demand.
 */
function readCompleteFilePatches(patch: string, truncated: boolean): Map<string, string> {
  const filePatches = splitPatchByFile(patch);
  const lastPath = [...filePatches.keys()].at(-1);
  if (truncated && lastPath !== undefined) filePatches.delete(lastPath);
  return filePatches;
}

function LatticeFileSection(props: {
  section: "staged" | "unstaged";
  scope: LatticeChangeScope;
  cwd: string;
  theme: "light" | "dark";
  mutating: boolean;
  onToggle: (paths: string[]) => void;
}) {
  const { scope } = props;
  const [openPath, setOpenPath] = useState<string | null>(null);
  // The patch can be a megabyte, so it is split once per read, not on every render.
  const filePatches = useMemo(
    () => readCompleteFilePatches(scope.patch, scope.truncated),
    [scope.patch, scope.truncated],
  );
  const staged = props.section === "staged";
  return (
    <section className="lattice-git-section" data-lattice-git-section={props.section}>
      <header className="lattice-git-section-head">
        <h3>{staged ? t("git:gitPanel_staged") : t("lattice:notStaged")}</h3>
        <span className="lattice-git-count">{scope.files.length}</span>
        <button
          type="button"
          className="lattice-git-link"
          disabled={props.mutating}
          onClick={() => props.onToggle(scope.files.flatMap(actionPathsOf))}
        >
          {staged ? t("lattice:unstageAll") : t("lattice:stageAll")}
        </button>
      </header>
      {scope.truncated ? (
        <p className="lattice-git-change-note" data-lattice-git-truncated="">
          {t("lattice:tooManyChangesToPreviewAtOnce")}
        </p>
      ) : null}
      <ul>
        {scope.files.map((file) => (
          <LatticeFileRow
            key={file.path}
            file={file}
            section={props.section}
            open={openPath === file.path}
            filePatch={filePatches.get(file.path)}
            cwd={props.cwd}
            theme={props.theme}
            mutating={props.mutating}
            onToggleOpen={() =>
              setOpenPath((current) => (current === file.path ? null : file.path))
            }
            onToggleStaged={() => props.onToggle(actionPathsOf(file))}
          />
        ))}
      </ul>
    </section>
  );
}

function LatticeFileRow(props: {
  file: GitChangedFile;
  section: "staged" | "unstaged";
  open: boolean;
  /** The file's complete patch, or undefined when it has to be loaded on its own. */
  filePatch: string | undefined;
  cwd: string;
  theme: "light" | "dark";
  mutating: boolean;
  onToggleOpen: () => void;
  onToggleStaged: () => void;
}) {
  const { file } = props;
  const staged = props.section === "staged";
  const { dir, name } = splitRepoRelativePath(file.path);
  const status = STATUS_LETTERS[file.status];
  const statusLabel =
    status === "A"
      ? t("common:added")
      : status === "D"
        ? t("lattice:deleted")
        : status === "R"
          ? t("lattice:renamed")
          : t("lattice:modified");
  return (
    <li className="lattice-git-file" data-open={props.open || undefined}>
      <div className="lattice-git-file-row">
        <Checkbox
          checked={staged}
          disabled={props.mutating}
          aria-label={
            staged
              ? t("lattice:unstage", { path: file.path })
              : t("lattice:stage", { path: file.path })
          }
          onCheckedChange={props.onToggleStaged}
        />
        <button
          type="button"
          className="lattice-git-file-name"
          title={file.path}
          aria-expanded={props.open}
          onClick={props.onToggleOpen}
        >
          <FileEntryIcon pathValue={file.path} kind="file" theme={props.theme} className="size-4" />
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
          {file.insertions > 0 ? <span data-kind="add">+{file.insertions}</span> : null}
          {file.deletions > 0 ? <span data-kind="del">−{file.deletions}</span> : null}
        </span>
      </div>
      {props.open ? (
        props.filePatch !== undefined ? (
          <LatticeFileChange
            path={file.path}
            filePatch={props.filePatch}
            truncated={false}
            theme={props.theme}
          />
        ) : (
          <LatticeLoadedFileChange
            cwd={props.cwd}
            section={props.section}
            path={file.path}
            theme={props.theme}
          />
        )
      ) : null}
    </li>
  );
}

/** A file the section's patch did not carry whole, read on its own when opened. */
function LatticeLoadedFileChange(props: {
  cwd: string;
  section: "staged" | "unstaged";
  path: string;
  theme: "light" | "dark";
}) {
  const query = useQuery(
    gitWorkingTreeDiffQueryOptions({ cwd: props.cwd, scope: props.section, filePath: props.path }),
  );
  if (query.data) {
    return (
      <LatticeFileChange
        path={props.path}
        filePatch={query.data.patch}
        truncated={query.data.truncated}
        theme={props.theme}
      />
    );
  }
  return (
    <p className="lattice-git-change-note">
      {query.error instanceof Error ? query.error.message : t("git:gitPanel_loading")}
    </p>
  );
}

/** A paper's change read as sentences; anything else in the usual code diff. */
function LatticeFileChange(props: {
  path: string;
  filePatch: string;
  /** The patch was cut at the response cap, so it ends partway through the change. */
  truncated: boolean;
  theme: "light" | "dark";
}) {
  const tooLarge = (
    <p className="lattice-git-change-note">{t("lattice:thisChangeIsTooLargeToShow")}</p>
  );
  if (isProsePath(props.path) && props.filePatch) {
    const { changes, truncated } = readProseChanges(props.filePatch);
    if (changes.length === 0) {
      return props.truncated ? (
        tooLarge
      ) : (
        <p className="lattice-git-change-note">{t("lattice:onlySpacingOrLineBreaksChanged")}</p>
      );
    }
    return (
      <div className="lattice-git-change">
        <ProseChangeList changes={changes} />
        {truncated || props.truncated ? (
          <p className="lattice-git-change-note">
            {t("lattice:showingTheFirstChangedLines", { count: changes.length })}
          </p>
        ) : null}
      </div>
    );
  }
  // A cut patch would render as a change it is not, so only a whole one is drawn.
  const renderable = props.truncated
    ? null
    : getRenderablePatch(props.filePatch, `lattice-git:${props.path}`);
  const fileDiff = renderable?.kind === "files" ? renderable.files[0] : undefined;
  if (!fileDiff) return props.filePatch ? tooLarge : null;
  return (
    <div className="lattice-git-change lattice-git-change-code diff-render-file">
      <SingleFileDiffBody fileDiff={fileDiff} theme={props.theme} />
    </div>
  );
}

/** Nothing to commit: say so with the drawing, then what is still left (a push or a pull). */
function LatticeCleanState(props: { cwd: string; actions: LatticeGitActions }) {
  const { actions } = props;
  const status = actions.status;
  const remote = UPSTREAM_REMOTE;
  const lastCommitQuery = useQuery(gitRecentCommitsQueryOptions({ cwd: props.cwd, limit: 1 }));
  const lastCommit = lastCommitQuery.data?.commits[0] ?? null;

  let description: string = t("lattice:editsYouMakeShowUpHereReady");
  let action: ReactNode = null;
  if (status && status.branch !== null) {
    if (status.hasUpstream && status.behindCount > 0 && status.aheadCount === 0) {
      description = t("lattice:newCommitsAreOnPullThemTo", { count: status.behindCount, remote });
      action = (
        <button
          type="button"
          className="lattice-git-button lattice-git-tinted"
          disabled={actions.isBusy}
          onClick={actions.pull}
        >
          <ArrowDownIcon aria-hidden className="size-3.5" />
          {t("lattice:pullCommits", { count: status.behindCount })}
        </button>
      );
    } else if (status.hasUpstream && status.aheadCount > 0 && status.behindCount === 0) {
      description = t("lattice:commitsAreWaitingToGoToPush", { count: status.aheadCount, remote });
      action = (
        <button
          type="button"
          className="lattice-git-button lattice-git-tinted"
          disabled={actions.isBusy}
          onClick={actions.push}
        >
          <PushIcon aria-hidden className="size-3.5" />
          {t("lattice:pushCommits", { count: status.aheadCount })}
        </button>
      );
    } else if (status.hasUpstream && status.aheadCount > 0) {
      description = t("lattice:branchHasDivergedFromUpstreamRebaseMerge");
    } else if (!status.hasUpstream && actions.hasOriginRemote) {
      description = t("lattice:isNotOnYetPublishItTo", { branch: status.branch, remote });
      action = (
        <button
          type="button"
          className="lattice-git-button lattice-git-tinted"
          disabled={actions.isBusy}
          onClick={actions.push}
        >
          <PushIcon aria-hidden className="size-3.5" />
          {t("lattice:publish2", { branch: status.branch })}
        </button>
      );
    }
  }

  return (
    <div className="lattice-git-clean" data-lattice-git-clean="">
      <div className="lattice-git-empty" role="status">
        <ResearchArt drawing={DATED_DRAFTS} />
        <p className="lattice-git-empty-title">{t("lattice:everythingIsCommitted")}</p>
        <p className="lattice-git-empty-description">{description}</p>
        {action ? <div className="lattice-git-empty-actions">{action}</div> : null}
      </div>
      {lastCommit ? (
        <footer className="lattice-git-last">
          <span className="lattice-git-last-label">{t("lattice:lastCommit")}</span>
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

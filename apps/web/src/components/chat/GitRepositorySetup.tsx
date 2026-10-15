import { useLingui } from "@lingui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import {
  gitConnectGitHubRemoteMutationOptions,
  gitCreateGitHubRepositoryMutationOptions,
  gitInitMutationOptions,
} from "~/lib/gitReactQuery";
import { githubInboxQueryKeys } from "~/lib/githubInboxQueryOptions";
import { GitBranchIcon, GitHubIcon, InfoIcon, LinkIcon, LoaderCircleIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ResearchArt } from "../researchArt/ResearchArt";
import { BLANK_LOGBOOK } from "../researchArt/blankLogbook";
import { Button } from "../ui/button";
import {
  dialogFieldLabelClassName,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import {
  isValidGitHubRemoteUrl,
  isValidGitHubRepositoryCreateName,
  suggestGitHubRepositoryName,
} from "./GitRepositorySetup.logic";

type GitHubRepositorySetupMode = "create" | "connect";
type GitHubRepositoryVisibility = "private" | "public";

function mutationErrorMessage(error: unknown, fallback: string): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : fallback;
}

/** Runs `git init` for a folder; the success toast is shared, the failure stays on the caller. */
export function useGitInitialization(cwd: string) {
  const { i18n } = useLingui();
  const queryClient = useQueryClient();
  const initMutation = useMutation(
    gitInitMutationOptions({
      cwd,
      queryClient,
    }),
  );

  const initialize = async () => {
    try {
      await initMutation.mutateAsync();
      // The Pull requests view read the folder as "not a repository"; let it read again.
      void queryClient.invalidateQueries({ queryKey: githubInboxQueryKeys.all });
      toastManager.add({
        type: "success",
        title: i18n._("Version control enabled"),
        description: i18n._("This folder is now a local Git repository."),
        timeout: 4_000,
      });
    } catch {
      // The inline error keeps the failure attached to the action.
    }
  };

  return { initialize, pending: initMutation.isPending, error: initMutation.error };
}

export function GitInitializationState(props: { cwd: string }) {
  const { i18n } = useLingui();
  const { initialize, pending, error } = useGitInitialization(props.cwd);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
      <div className="flex max-w-72 flex-col items-center text-center">
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-border/70 bg-foreground/[0.035] text-foreground/80">
          <GitBranchIcon className="size-4.5" />
        </div>
        <h2 className="font-system-ui text-ui-lg font-medium text-foreground">
          {i18n._("Start version control")}
        </h2>
        <p className="mt-1.5 text-ui-sm leading-relaxed text-muted-foreground">
          {i18n._(
            "Track changes locally, review diffs, and restore earlier work. Nothing is uploaded.",
          )}
        </p>
        <Button size="sm" className="mt-4" disabled={pending} onClick={() => void initialize()}>
          {pending ? (
            <LoaderCircleIcon className="size-3.5 animate-spin" />
          ) : (
            <GitBranchIcon className="size-3.5" />
          )}
          {pending ? i18n._("Initializing…") : i18n._("Initialize Git")}
        </Button>
        {error ? (
          <p role="alert" className="mt-3 text-ui-xs leading-snug text-destructive">
            {mutationErrorMessage(error, i18n._("Git could not be initialized."))}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Lattice's Initialize Git button, for the Changes and Pull requests empty states. */
export function LatticeGitInitializeButton(props: { cwd: string }) {
  const { i18n } = useLingui();
  const { initialize, pending, error } = useGitInitialization(props.cwd);
  return (
    <>
      <button
        type="button"
        className="lattice-git-button lattice-git-tinted"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() => void initialize()}
      >
        {pending ? (
          <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" />
        ) : (
          <GitBranchIcon aria-hidden className="size-3.5" />
        )}
        <span className="lattice-git-button-label">
          {pending ? i18n._("Initializing…") : i18n._("Initialize Git")}
        </span>
      </button>
      {error ? (
        <LatticeErrorNote
          message={i18n._("Git could not be initialized in this folder")}
          detail={error instanceof Error ? error.message : null}
        />
      ) : null}
    </>
  );
}

/**
 * A failure in words, with what Git or the GitHub CLI printed folded under Details: the raw
 * output helps someone debugging, but it is never the message.
 */
export function LatticeErrorNote(props: { message: string; detail: string | null }) {
  return (
    <div className="lattice-git-error" role="alert">
      <p>{props.message}</p>
      <LatticeErrorDetails detail={props.detail} />
    </div>
  );
}

export function LatticeErrorDetails(props: { detail: string | null | undefined }) {
  const { i18n } = useLingui();
  const detail = props.detail?.trim();
  if (!detail) return null;
  return (
    <details className="lattice-git-details">
      <summary>{i18n._("Details")}</summary>
      <pre>{detail}</pre>
    </details>
  );
}

/** Lattice's Changes view on a folder that is not a Git repository yet. */
export function LatticeGitInitializationState(props: { cwd: string }) {
  const { i18n } = useLingui();
  return (
    <div className="lattice-git lattice-source-control" data-lattice-git-init="">
      <div className="lattice-git-scroll">
        <div className="lattice-git-empty" role="status">
          <ResearchArt drawing={BLANK_LOGBOOK} />
          <p className="lattice-git-empty-title">{i18n._("Start version control")}</p>
          <p className="lattice-git-empty-description">
            {i18n._(
              "Keep a history of this project on your Mac: see what changed since each commit and go back to any earlier version. Nothing is uploaded",
            )}
          </p>
          <div className="lattice-git-empty-actions">
            <LatticeGitInitializeButton cwd={props.cwd} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function GitHubRemoteSetupCard(props: { cwd: string }) {
  const { i18n } = useLingui();
  const [dialogMode, setDialogMode] = useState<GitHubRepositorySetupMode | null>(null);

  return (
    <>
      <section className="mx-2 mt-2 rounded-xl border border-border/70 bg-foreground/[0.025] p-2.5">
        <div className="flex items-start gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.045] text-foreground/75">
            <GitHubIcon className="size-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-system-ui text-ui font-medium text-[var(--color-text-foreground)]">
              {i18n._("Connect to GitHub")}
            </h2>
            <p className="mt-0.5 text-ui-xs leading-relaxed text-[var(--color-text-foreground-secondary)]">
              {i18n._("Publish a new private repository or attach one you already have.")}
            </p>
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          <Button size="xs" onClick={() => setDialogMode("create")}>
            <GitHubIcon />
            {i18n._("Publish")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="text-[var(--color-text-foreground)]"
            onClick={() => setDialogMode("connect")}
          >
            <LinkIcon />
            {i18n._("Connect existing")}
          </Button>
        </div>
      </section>
      {dialogMode ? (
        <GitHubRepositorySetupDialog
          key={dialogMode}
          cwd={props.cwd}
          mode={dialogMode}
          open
          onOpenChange={(open) => {
            if (!open) setDialogMode(null);
          }}
        />
      ) : null}
    </>
  );
}

export function GitHubRepositorySetupDialog(props: {
  cwd: string;
  mode: GitHubRepositorySetupMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { i18n } = useLingui();

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <div className="mb-1 flex size-9 items-center justify-center rounded-xl border border-border/70 bg-foreground/[0.035] text-foreground/80">
            {props.mode === "create" ? (
              <GitHubIcon className="size-4" />
            ) : (
              <LinkIcon className="size-4" />
            )}
          </div>
          <DialogTitle>
            {props.mode === "create"
              ? i18n._("Publish to GitHub")
              : i18n._("Connect GitHub repository")}
          </DialogTitle>
          <DialogDescription>
            {props.mode === "create"
              ? i18n._(
                  "Create a GitHub repository for this folder. Your files stay local until you commit and push them.",
                )
              : i18n._(
                  "Attach an existing GitHub repository as origin. This does not fetch, pull, or upload files.",
                )}
          </DialogDescription>
        </DialogHeader>
        <GitHubRepositorySetupForm
          cwd={props.cwd}
          mode={props.mode}
          onCancel={() => props.onOpenChange(false)}
          onComplete={(result) => {
            props.onOpenChange(false);
            toastManager.add({
              type: "success",
              title:
                props.mode === "create"
                  ? i18n._("GitHub repository created")
                  : i18n._("GitHub repository connected"),
              description:
                props.mode === "create"
                  ? i18n._("{repository} is ready. Files stay local until your first push.", {
                      repository: result.repository,
                    })
                  : i18n._("{repository} is now connected as {remoteName}.", {
                      repository: result.repository,
                      remoteName: result.remoteName,
                    }),
              timeout: 5_000,
            });
          }}
        />
      </DialogPopup>
    </Dialog>
  );
}

function GitHubRepositorySetupForm(props: {
  cwd: string;
  mode: GitHubRepositorySetupMode;
  onCancel: () => void;
  onComplete: (result: { repository: string; remoteName: string; url: string }) => void;
}) {
  const { i18n } = useLingui();
  const queryClient = useQueryClient();
  const repositoryNameId = useId();
  const descriptionId = useId();
  const remoteUrlId = useId();
  const [repositoryName, setRepositoryName] = useState(() =>
    suggestGitHubRepositoryName(props.cwd),
  );
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<GitHubRepositoryVisibility>("private");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const createMutation = useMutation(
    gitCreateGitHubRepositoryMutationOptions({ cwd: props.cwd, queryClient }),
  );
  const connectMutation = useMutation(
    gitConnectGitHubRemoteMutationOptions({ cwd: props.cwd, queryClient }),
  );
  const mutation = props.mode === "create" ? createMutation : connectMutation;
  const isPending = mutation.isPending;
  const createNameValid = isValidGitHubRepositoryCreateName(repositoryName);
  const remoteUrlValid = isValidGitHubRemoteUrl(remoteUrl);
  const valid = props.mode === "create" ? createNameValid : remoteUrlValid;

  const submit = async () => {
    setSubmitted(true);
    if (!valid || isPending) return;
    try {
      const result =
        props.mode === "create"
          ? await createMutation.mutateAsync({
              name: repositoryName.trim(),
              visibility,
              ...(description.trim() ? { description: description.trim() } : {}),
            })
          : await connectMutation.mutateAsync({ url: remoteUrl.trim() });
      props.onComplete(result);
    } catch {
      // Mutation state is rendered below the fields.
    }
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogPanel className="space-y-4">
        {props.mode === "create" ? (
          <>
            <div className="space-y-1.5">
              <label htmlFor={repositoryNameId} className={dialogFieldLabelClassName}>
                {i18n._("Repository name")}
              </label>
              <Input
                id={repositoryNameId}
                autoFocus
                value={repositoryName}
                aria-invalid={submitted && !createNameValid}
                disabled={isPending}
                onChange={(event) => setRepositoryName(event.target.value)}
                placeholder="research-writer"
              />
              {submitted && !createNameValid ? (
                <p role="alert" className="text-ui-xs text-destructive">
                  {i18n._("Use letters, numbers, periods, hyphens, or underscores.")}
                </p>
              ) : (
                <p className="text-ui-xs text-muted-foreground">
                  {i18n._("You can also use owner/repository to publish to an organization.")}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label htmlFor={descriptionId} className={dialogFieldLabelClassName}>
                {i18n._("Description")}{" "}
                <span className="font-normal text-muted-foreground">{i18n._("Optional")}</span>
              </label>
              <Input
                id={descriptionId}
                value={description}
                disabled={isPending}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={i18n._("What is this project about?")}
              />
            </div>
            <fieldset className="space-y-1.5">
              <legend className={dialogFieldLabelClassName}>{i18n._("Visibility")}</legend>
              <div
                role="radiogroup"
                aria-label={i18n._("Repository visibility")}
                className="grid grid-cols-2 gap-2"
              >
                {(
                  [
                    ["private", i18n._("Private"), i18n._("Only you and invited collaborators")],
                    ["public", i18n._("Public"), i18n._("Visible to everyone")],
                  ] as const
                ).map(([value, label, help]) => {
                  const selected = visibility === value;
                  return (
                    <Button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      variant="outline"
                      className={cn(
                        "h-auto min-h-14 flex-col items-start gap-0.5 px-2.5 py-2 text-left",
                        selected &&
                          "border-foreground/20 bg-foreground/[0.055] [:hover,[data-pressed]]:bg-foreground/[0.075]",
                      )}
                      disabled={isPending}
                      onClick={() => setVisibility(value)}
                    >
                      <span className="text-ui font-medium">{label}</span>
                      <span className="whitespace-normal text-ui-xs font-normal leading-snug text-muted-foreground">
                        {help}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </fieldset>
          </>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor={remoteUrlId} className={dialogFieldLabelClassName}>
              {i18n._("Repository URL")}
            </label>
            <Input
              id={remoteUrlId}
              autoFocus
              value={remoteUrl}
              aria-invalid={submitted && !remoteUrlValid}
              disabled={isPending}
              onChange={(event) => setRemoteUrl(event.target.value)}
              placeholder="https://github.com/owner/repository.git"
            />
            {submitted && !remoteUrlValid ? (
              <p role="alert" className="text-ui-xs text-destructive">
                {i18n._("Enter a GitHub HTTPS or SSH repository URL.")}
              </p>
            ) : (
              <p className="text-ui-xs text-muted-foreground">
                {i18n._("HTTPS and git@github.com SSH URLs are supported.")}
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2 rounded-lg bg-foreground/[0.035] px-2.5 py-2 text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          <p className="text-ui-xs leading-relaxed">
            {props.mode === "create"
              ? i18n._(
                  "Publishing creates the empty remote only. Review your files and .gitignore before the first push.",
                )
              : i18n._(
                  "Connecting changes repository configuration only. Your working files are not modified.",
                )}
          </p>
        </div>

        {mutation.error ? (
          <p role="alert" className="text-ui-xs leading-snug text-destructive">
            {mutationErrorMessage(
              mutation.error,
              i18n._("The GitHub setup could not be completed."),
            )}
          </p>
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={isPending} onClick={props.onCancel}>
          {i18n._("Cancel")}
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
          {isPending
            ? props.mode === "create"
              ? i18n._("Creating…")
              : i18n._("Connecting…")
            : props.mode === "create"
              ? i18n._("Create repository")
              : i18n._("Connect repository")}
        </Button>
      </DialogFooter>
    </form>
  );
}

import { t } from "~/i18n";

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
        title: t("lattice:versionControlEnabled"),
        description: t("lattice:thisFolderIsNowALocalGit"),
        timeout: 4_000,
      });
    } catch {
      // The inline error keeps the failure attached to the action.
    }
  };

  return { initialize, pending: initMutation.isPending, error: initMutation.error };
}

export function GitInitializationState(props: { cwd: string }) {
  const { initialize, pending, error } = useGitInitialization(props.cwd);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
      <div className="flex max-w-72 flex-col items-center text-center">
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-border/70 bg-foreground/[0.035] text-foreground/80">
          <GitBranchIcon className="size-4.5" />
        </div>
        <h2 className="font-system-ui text-ui-lg font-medium text-foreground">
          {t("lattice:startVersionControl")}
        </h2>
        <p className="mt-1.5 text-ui-sm leading-relaxed text-muted-foreground">
          {t("lattice:trackChangesLocallyReviewDiffsAndRestore")}
        </p>
        <Button size="sm" className="mt-4" disabled={pending} onClick={() => void initialize()}>
          {pending ? (
            <LoaderCircleIcon className="size-3.5 animate-spin" />
          ) : (
            <GitBranchIcon className="size-3.5" />
          )}
          {pending ? t("git:initializing") : t("git:initializeGit")}
        </Button>
        {error ? (
          <p role="alert" className="mt-3 text-ui-xs leading-snug text-destructive">
            {mutationErrorMessage(error, t("lattice:gitCouldNotBeInitialized"))}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Lattice's Initialize Git button, for the Changes and Pull requests empty states. */
export function LatticeGitInitializeButton(props: { cwd: string }) {
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
          {pending ? t("git:initializing") : t("git:initializeGit")}
        </span>
      </button>
      {error ? (
        <LatticeErrorNote
          message={t("lattice:gitCouldNotBeInitializedInThis")}
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
  const detail = props.detail?.trim();
  if (!detail) return null;
  return (
    <details className="lattice-git-details">
      <summary>{t("common:detail_details")}</summary>
      <pre>{detail}</pre>
    </details>
  );
}

/** Lattice's Changes view on a folder that is not a Git repository yet. */
export function LatticeGitInitializationState(props: { cwd: string }) {
  return (
    <div className="lattice-git lattice-source-control" data-lattice-git-init="">
      <div className="lattice-git-scroll">
        <div className="lattice-git-empty" role="status">
          <ResearchArt drawing={BLANK_LOGBOOK} />
          <p className="lattice-git-empty-title">{t("lattice:startVersionControl")}</p>
          <p className="lattice-git-empty-description">
            {t("lattice:keepAHistoryOfThisProjectOn")}
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
              {t("lattice:connectToGitHub")}
            </h2>
            <p className="mt-0.5 text-ui-xs leading-relaxed text-[var(--color-text-foreground-secondary)]">
              {t("lattice:publishANewPrivateRepositoryOrAttach")}
            </p>
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          <Button size="xs" onClick={() => setDialogMode("create")}>
            <GitHubIcon />
            {t("lattice:publish")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="text-[var(--color-text-foreground)]"
            onClick={() => setDialogMode("connect")}
          >
            <LinkIcon />
            {t("lattice:connectExisting")}
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
              ? t("lattice:publishToGitHub")
              : t("lattice:connectGitHubRepository")}
          </DialogTitle>
          <DialogDescription>
            {props.mode === "create"
              ? t("lattice:createAGitHubRepositoryForThisFolder")
              : t("lattice:attachAnExistingGitHubRepositoryAsOrigin")}
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
                  ? t("lattice:gitHubRepositoryCreated")
                  : t("lattice:gitHubRepositoryConnected"),
              description:
                props.mode === "create"
                  ? t("lattice:isReadyFilesStayLocalUntilYour", { repository: result.repository })
                  : t("lattice:isNowConnectedAs", {
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
                {t("lattice:repositoryName")}
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
                  {t("lattice:useLettersNumbersPeriodsHyphensOrUnderscores")}
                </p>
              ) : (
                <p className="text-ui-xs text-muted-foreground">
                  {t("lattice:youCanAlsoUseOwnerRepositoryTo")}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label htmlFor={descriptionId} className={dialogFieldLabelClassName}>
                {t("git:description")}{" "}
                <span className="font-normal text-muted-foreground">{t("lattice:optional")}</span>
              </label>
              <Input
                id={descriptionId}
                value={description}
                disabled={isPending}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("lattice:whatIsThisProjectAbout")}
              />
            </div>
            <fieldset className="space-y-1.5">
              <legend className={dialogFieldLabelClassName}>{t("lattice:visibility")}</legend>
              <div
                role="radiogroup"
                aria-label={t("lattice:repositoryVisibility")}
                className="grid grid-cols-2 gap-2"
              >
                {(
                  [
                    ["private", t("lattice:private"), t("lattice:onlyYouAndInvitedCollaborators")],
                    ["public", t("lattice:public"), t("lattice:visibleToEveryone")],
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
              {t("lattice:repositoryURL")}
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
                {t("lattice:enterAGitHubHTTPSOrSSHRepository")}
              </p>
            ) : (
              <p className="text-ui-xs text-muted-foreground">
                {t("lattice:hTTPSAndGitGithubComSSHURLs")}
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2 rounded-lg bg-foreground/[0.035] px-2.5 py-2 text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          <p className="text-ui-xs leading-relaxed">
            {props.mode === "create"
              ? t("lattice:publishingCreatesTheEmptyRemoteOnlyReview")
              : t("lattice:connectingChangesRepositoryConfigurationOnlyYourWorking")}
          </p>
        </div>

        {mutation.error ? (
          <p role="alert" className="text-ui-xs leading-snug text-destructive">
            {mutationErrorMessage(mutation.error, t("lattice:theGitHubSetupCouldNotBeCompleted"))}
          </p>
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={isPending} onClick={props.onCancel}>
          {t("common:form_cancel")}
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
          {isPending
            ? props.mode === "create"
              ? t("workspace:creating")
              : t("computer:connecting")
            : props.mode === "create"
              ? t("lattice:createRepository")
              : t("lattice:connectRepository")}
        </Button>
      </DialogFooter>
    </form>
  );
}

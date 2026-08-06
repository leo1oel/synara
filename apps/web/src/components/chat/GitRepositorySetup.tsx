import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import {
  gitConnectGitHubRemoteMutationOptions,
  gitCreateGitHubRepositoryMutationOptions,
  gitInitMutationOptions,
} from "~/lib/gitReactQuery";
import { GitBranchIcon, GitHubIcon, InfoIcon, LinkIcon, LoaderCircleIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
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

function mutationErrorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : "The GitHub setup could not be completed.";
}

export function GitInitializationState(props: { cwd: string }) {
  const queryClient = useQueryClient();
  const initMutation = useMutation(
    gitInitMutationOptions({
      cwd: props.cwd,
      queryClient,
    }),
  );

  const initialize = async () => {
    try {
      await initMutation.mutateAsync();
      toastManager.add({
        type: "success",
        title: "Version control enabled",
        description: "This folder is now a local Git repository.",
        timeout: 4_000,
      });
    } catch {
      // The inline error keeps the failure attached to the action.
    }
  };

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
      <div className="flex max-w-72 flex-col items-center text-center">
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-border/70 bg-foreground/[0.035] text-foreground/80">
          <GitBranchIcon className="size-4.5" />
        </div>
        <h2 className="font-system-ui text-[length:var(--app-font-size-ui-lg,13px)] font-medium text-foreground">
          Start version control
        </h2>
        <p className="mt-1.5 text-[length:var(--app-font-size-ui-sm,11px)] leading-relaxed text-muted-foreground">
          Track changes locally, review diffs, and restore earlier work. Nothing is uploaded.
        </p>
        <Button
          size="sm"
          className="mt-4"
          disabled={initMutation.isPending}
          onClick={() => void initialize()}
        >
          {initMutation.isPending ? (
            <LoaderCircleIcon className="size-3.5 animate-spin" />
          ) : (
            <GitBranchIcon className="size-3.5" />
          )}
          {initMutation.isPending ? "Initializing…" : "Initialize Git"}
        </Button>
        {initMutation.error ? (
          <p
            role="alert"
            className="mt-3 text-[length:var(--app-font-size-ui-xs,10px)] leading-snug text-destructive"
          >
            {mutationErrorMessage(initMutation.error)}
          </p>
        ) : null}
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
            <h2 className="font-system-ui text-[length:var(--app-font-size-ui,12px)] font-medium text-[var(--color-text-foreground)]">
              Connect to GitHub
            </h2>
            <p className="mt-0.5 text-[length:var(--app-font-size-ui-xs,10px)] leading-relaxed text-[var(--color-text-foreground-secondary)]">
              Publish a new private repository or attach one you already have.
            </p>
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          <Button size="xs" onClick={() => setDialogMode("create")}>
            <GitHubIcon />
            Publish
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="text-[var(--color-text-foreground)]"
            onClick={() => setDialogMode("connect")}
          >
            <LinkIcon />
            Connect existing
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

function GitHubRepositorySetupDialog(props: {
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
            {props.mode === "create" ? "Publish to GitHub" : "Connect GitHub repository"}
          </DialogTitle>
          <DialogDescription>
            {props.mode === "create"
              ? "Create a GitHub repository for this folder. Your files stay local until you commit and push them."
              : "Attach an existing GitHub repository as origin. This does not fetch, pull, or upload files."}
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
                  ? "GitHub repository created"
                  : "GitHub repository connected",
              description:
                props.mode === "create"
                  ? `${result.repository} is ready. Files stay local until your first push.`
                  : `${result.repository} is now connected as ${result.remoteName}.`,
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
                Repository name
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
                <p
                  role="alert"
                  className="text-[length:var(--app-font-size-ui-xs,10px)] text-destructive"
                >
                  Use letters, numbers, periods, hyphens, or underscores.
                </p>
              ) : (
                <p className="text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
                  You can also use owner/repository to publish to an organization.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label htmlFor={descriptionId} className={dialogFieldLabelClassName}>
                Description <span className="font-normal text-muted-foreground">Optional</span>
              </label>
              <Input
                id={descriptionId}
                value={description}
                disabled={isPending}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What is this project about?"
              />
            </div>
            <fieldset className="space-y-1.5">
              <legend className={dialogFieldLabelClassName}>Visibility</legend>
              <div
                role="radiogroup"
                aria-label="Repository visibility"
                className="grid grid-cols-2 gap-2"
              >
                {(
                  [
                    ["private", "Private", "Only you and invited collaborators"],
                    ["public", "Public", "Visible to everyone"],
                  ] as const
                ).map(([value, label, help]) => {
                  const selected = visibility === value;
                  return (
                    <Button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      variant={selected ? "secondary-outline" : "outline"}
                      className={cn(
                        "h-auto min-h-14 flex-col items-start gap-0.5 px-2.5 py-2 text-left",
                        selected && "border-foreground/20 bg-foreground/[0.055]",
                      )}
                      disabled={isPending}
                      onClick={() => setVisibility(value)}
                    >
                      <span className="text-[length:var(--app-font-size-ui,12px)] font-medium">
                        {label}
                      </span>
                      <span className="whitespace-normal text-[length:var(--app-font-size-ui-xs,10px)] font-normal leading-snug text-muted-foreground">
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
              Repository URL
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
              <p
                role="alert"
                className="text-[length:var(--app-font-size-ui-xs,10px)] text-destructive"
              >
                Enter a GitHub HTTPS or SSH repository URL.
              </p>
            ) : (
              <p className="text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
                HTTPS and git@github.com SSH URLs are supported.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2 rounded-lg bg-foreground/[0.035] px-2.5 py-2 text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          <p className="text-[length:var(--app-font-size-ui-xs,10px)] leading-relaxed">
            {props.mode === "create"
              ? "Publishing creates the empty remote only. Review your files and .gitignore before the first push."
              : "Connecting changes repository configuration only. Your working files are not modified."}
          </p>
        </div>

        {mutation.error ? (
          <p
            role="alert"
            className="text-[length:var(--app-font-size-ui-xs,10px)] leading-snug text-destructive"
          >
            {mutationErrorMessage(mutation.error)}
          </p>
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={isPending} onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
          {isPending
            ? props.mode === "create"
              ? "Creating…"
              : "Connecting…"
            : props.mode === "create"
              ? "Create repository"
              : "Connect repository"}
        </Button>
      </DialogFooter>
    </form>
  );
}

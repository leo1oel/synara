// FILE: ComposerMcpDialog.tsx
// Purpose: The `/mcp` view: the active agent's MCP servers as its runtime reports
//          them, with sign-in, sign-out, reconnect, and enable/disable per server.
// Layer: Chat composer UI
// Exports: ComposerMcpDialog

import type {
  ProviderInstanceId,
  ProviderKind,
  ProviderMcpServerAction,
  ProviderMcpServerDescriptor,
  ProviderMcpServerStatus,
} from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { openExternalLink } from "~/lib/linkChips";
import { Loader2Icon, RefreshCwIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "../../nativeApi";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { StatusChip } from "../ui/status-chip";
import { toastManager } from "../ui/toast";

// Long enough for a provider sign-in page and a password manager; the runtime
// keeps its redirect listener up for the same window.
const SIGN_IN_WATCH_MS = 10 * 60_000;
const POLL_MS = 2_000;

const STATUS_DOT_CLASS_NAME: Record<ProviderMcpServerStatus, string> = {
  connected: "bg-emerald-500",
  "needs-auth": "bg-amber-500",
  pending: "bg-sky-500",
  failed: "bg-red-500",
  disabled: "bg-muted-foreground/40",
};

const STATUS_TEXT_CLASS_NAME: Record<ProviderMcpServerStatus, string> = {
  connected: "text-emerald-700 dark:text-emerald-300",
  "needs-auth": "text-amber-700 dark:text-amber-300",
  pending: "text-muted-foreground",
  failed: "text-red-700 dark:text-red-300",
  disabled: "text-muted-foreground",
};

function statusLabel(status: ProviderMcpServerStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "needs-auth":
      return "Needs sign-in";
    case "pending":
      return "Connecting…";
    case "failed":
      return "Failed";
    case "disabled":
      return "Disabled";
  }
}

function actionLabel(action: ProviderMcpServerAction): string {
  switch (action) {
    case "authenticate":
      return "Sign in";
    case "reconnect":
      return "Reconnect";
    case "enable":
      return "Enable";
    case "disable":
      return "Disable";
    case "sign-out":
      return "Sign out";
  }
}

function actionDoneMessage(action: ProviderMcpServerAction, server: string): string {
  switch (action) {
    case "reconnect":
      return `Reconnected ${server}`;
    case "enable":
      return `Enabled ${server}`;
    case "disable":
      return `Disabled ${server}`;
    case "authenticate":
      return `Signed in to ${server}`;
    case "sign-out":
      return `Signed out of ${server}`;
  }
}

function scopeLabel(scope: string): string {
  switch (scope) {
    case "user":
      return "User";
    case "project":
      return "Project";
    case "local":
      return "Local";
    case "plugin":
      return "Plugin";
    default:
      return scope;
  }
}

function serverMeta(server: ProviderMcpServerDescriptor): string {
  return [
    server.transport === "stdio" ? "stdio" : server.transport.toUpperCase(),
    server.endpoint ? server.endpoint.replace(/^https?:\/\//, "") : null,
    server.scope ? scopeLabel(server.scope) : null,
    server.toolCount !== null
      ? server.toolCount === 1
        ? "1 tool"
        : `${server.toolCount} tools`
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function emptyStateHint(provider: ProviderKind): string {
  return provider === "codex"
    ? "Add one in Terminal with codex mcp add, then reopen /mcp."
    : "Add one in Terminal with claude mcp add, then reopen /mcp.";
}

export function ComposerMcpDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderKind;
  instanceId: ProviderInstanceId | null;
  cwd: string | null;
  threadId: string;
}) {
  const { open, onOpenChange, provider, instanceId, cwd, threadId } = props;
  const [busyServer, setBusyServer] = useState<string | null>(null);
  // Signing out is asked for once more in the row before it runs.
  const [confirmingSignOut, setConfirmingSignOut] = useState<string | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  // Each opening, and each Refresh, asks the runtime to re-read its MCP config
  // once (a server added in Terminal since the last look then shows up); the
  // polls in between only re-read status.
  const [view, setView] = useState({ open: false, generation: 0 });
  if (view.open !== open) {
    setView({ open, generation: open ? view.generation + 1 : view.generation });
  }
  const reloadedGenerations = useRef(new Set<number>());
  const [signIn, setSignIn] = useState<{
    readonly server: string;
    readonly authUrl: string;
    readonly startedAt: number;
  } | null>(null);

  const requestBase =
    cwd === null
      ? null
      : {
          provider,
          ...(instanceId ? { instanceId } : {}),
          cwd,
          threadId,
        };

  const queryKeyBase = ["provider-mcp-servers", provider, instanceId, cwd, threadId] as const;
  const serversQuery = useQuery({
    queryKey: [...queryKeyBase, view.generation] as const,
    queryFn: () => {
      if (!requestBase) throw new Error("Open a project folder to see MCP servers.");
      const forceReload = !reloadedGenerations.current.has(view.generation);
      reloadedGenerations.current.add(view.generation);
      return ensureNativeApi().provider.listMcpServers({
        ...requestBase,
        ...(forceReload ? { forceReload: true } : {}),
      });
    },
    enabled: open && requestBase !== null,
    // Keep watching while a server is still connecting; the runtime finishes on its own.
    refetchInterval: (query) =>
      query.state.data?.servers.some((server) => server.status === "pending") ? POLL_MS : false,
    placeholderData: (previous) => previous,
    staleTime: 0,
    gcTime: 30_000,
  });
  const servers = serversQuery.data?.servers ?? [];

  // While the browser has the sign-in page, watch only that server: asking for
  // every server would make the runtime reconnect all of them on each poll.
  const signInQuery = useQuery({
    queryKey: [...queryKeyBase, "sign-in", signIn?.authUrl ?? null] as const,
    queryFn: () => {
      if (!requestBase || !signIn) throw new Error("Open a project folder to see MCP servers.");
      return ensureNativeApi().provider.listMcpServers({
        ...requestBase,
        serverName: signIn.server,
      });
    },
    enabled: open && signIn !== null && requestBase !== null,
    refetchInterval: POLL_MS,
    staleTime: 0,
    gcTime: 0,
  });

  // A sign-in ends when the runtime reports the server connected, or when the
  // window the runtime keeps its redirect listener open for has passed.
  const signedInServer = signIn
    ? signInQuery.data?.servers.find(
        (server) => server.name === signIn.server && server.status === "connected",
      )
    : undefined;
  const refetchServers = serversQuery.refetch;
  const announcedSignInRef = useRef<string | null>(null);
  useEffect(() => {
    if (!signIn) return;
    if (signedInServer && announcedSignInRef.current !== signIn.authUrl) {
      announcedSignInRef.current = signIn.authUrl;
      toastManager.add({
        type: "success",
        title: actionDoneMessage("authenticate", signIn.server),
      });
      setSignIn(null);
      void refetchServers();
      return;
    }
    const remaining = signIn.startedAt + SIGN_IN_WATCH_MS - Date.now();
    const timer = setTimeout(() => setSignIn(null), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [signIn, signedInServer, refetchServers]);

  useEffect(() => {
    if (!open) {
      setSignIn(null);
      setConfirmingSignOut(null);
    }
  }, [open]);

  const runAction = async (
    server: ProviderMcpServerDescriptor,
    action: ProviderMcpServerAction,
  ) => {
    if (!requestBase) return;
    setConfirmingSignOut(null);
    setBusyServer(server.name);
    try {
      const result = await ensureNativeApi().provider.runMcpServerAction({
        ...requestBase,
        serverName: server.name,
        action,
      });
      if (action === "authenticate" && result.authUrl) {
        setSignIn({ server: server.name, authUrl: result.authUrl, startedAt: Date.now() });
        openExternalLink(result.authUrl);
      } else if (action === "sign-out") {
        // An HTTP server that never asked for a sign-in has nothing to clear and
        // simply reconnects; say so rather than claim a sign-out.
        const refreshed = await serversQuery.refetch();
        const after = refreshed.data?.servers.find((entry) => entry.name === server.name);
        toastManager.add(
          after?.status === "connected"
            ? {
                type: "info",
                title: `${server.name} has no saved sign-in`,
                description: "It is still connected.",
              }
            : {
                type: "success",
                title: actionDoneMessage(action, server.name),
                description: "Sign in again to connect an account.",
              },
        );
      } else {
        toastManager.add({ type: "success", title: actionDoneMessage(action, server.name) });
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: `Could not update ${server.name}`,
        description:
          error instanceof Error ? error.message : "The agent did not accept the request.",
      });
    } finally {
      setBusyServer(null);
      void serversQuery.refetch();
    }
  };

  const description =
    serversQuery.data?.source === "workspace"
      ? "No agent session is running in this thread, so this is what a new session in this folder loads."
      : "The servers this thread's agent session has loaded.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader className="pe-12">
          <div className="flex min-w-0 items-center gap-2">
            <DialogTitle className="min-w-0 truncate">MCP servers</DialogTitle>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="shrink-0"
              aria-label="Refresh"
              disabled={serversQuery.isFetching || requestBase === null}
              onClick={() => setView({ open, generation: view.generation + 1 })}
            >
              <RefreshCwIcon className={cn(serversQuery.isFetching && "animate-spin")} />
            </Button>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-2">
          {serversQuery.isPending && requestBase !== null ? (
            <div className="flex items-center gap-2 py-6 text-ui text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              Asking the agent for its MCP servers…
            </div>
          ) : serversQuery.isError && servers.length === 0 ? (
            <div className="space-y-2 rounded-lg border border-border/60 bg-card p-4">
              <p className="text-ui leading-snug text-foreground">Could not read MCP servers</p>
              <p className="text-ui-sm leading-snug break-words text-muted-foreground">
                {serversQuery.error instanceof Error
                  ? serversQuery.error.message
                  : "The agent did not answer."}
              </p>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => void serversQuery.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : servers.length === 0 ? (
            <div className="space-y-1 rounded-lg border border-border/60 bg-card p-4">
              <p className="text-ui leading-snug text-foreground">No MCP servers are configured.</p>
              <p className="text-ui-sm leading-snug text-muted-foreground">
                {emptyStateHint(provider)}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card">
              {servers.map((server) => {
                const busy = busyServer === server.name;
                const waitingForBrowser = signIn?.server === server.name;
                return (
                  <li key={server.name} className="space-y-1 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <div className="min-w-0 flex-1 basis-40">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-ui-lg font-medium text-foreground">
                            {server.name}
                          </span>
                          <StatusChip
                            className={cn("shrink-0", STATUS_TEXT_CLASS_NAME[server.status])}
                            dotClassName={STATUS_DOT_CLASS_NAME[server.status]}
                            pulse={server.status === "pending"}
                          >
                            {statusLabel(server.status)}
                          </StatusChip>
                        </div>
                        <p className="truncate text-ui-sm text-muted-foreground">
                          {serverMeta(server)}
                        </p>
                      </div>
                      {server.actions.length > 0 ? (
                        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-1.5">
                          {busy ? (
                            <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
                          ) : null}
                          {server.actions.map((action) => (
                            <Button
                              key={action}
                              type="button"
                              size="xs"
                              variant={action === "authenticate" ? "default" : "outline"}
                              disabled={
                                busy || busyServer !== null || confirmingSignOut === server.name
                              }
                              onClick={() =>
                                action === "sign-out"
                                  ? setConfirmingSignOut(server.name)
                                  : void runAction(server, action)
                              }
                            >
                              {actionLabel(action)}
                            </Button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {server.error ? (
                      <p className="line-clamp-3 text-ui-sm leading-snug break-words text-red-700 dark:text-red-300">
                        {server.error}
                      </p>
                    ) : null}
                    {confirmingSignOut === server.name ? (
                      provider === "codex" ? (
                        <div className="mt-1.5 space-y-1.5 rounded-md border border-border/60 bg-muted/40 p-2.5">
                          <p className="text-ui-sm leading-snug font-medium text-foreground">
                            Sign out of {server.name} in Terminal
                          </p>
                          <p className="text-ui-sm leading-snug text-muted-foreground">
                            {
                              "Codex can't sign out of an MCP server from here. Run this command, then press Reconnect:"
                            }
                          </p>
                          <code className="block rounded bg-background px-2 py-1 font-mono text-ui-sm break-words text-foreground">
                            codex mcp logout {server.name}
                          </code>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => setConfirmingSignOut(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => copyToClipboard(`codex mcp logout ${server.name}`)}
                            >
                              {isCopied ? "Copied" : "Copy command"}
                            </Button>
                            <Button
                              type="button"
                              size="xs"
                              disabled={busyServer !== null}
                              onClick={() => void runAction(server, "reconnect")}
                            >
                              Reconnect
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1.5 space-y-1.5 rounded-md border border-border/60 bg-muted/40 p-2.5">
                          <p className="text-ui-sm leading-snug font-medium text-foreground">
                            Sign out of {server.name}?
                          </p>
                          <p className="text-ui-sm leading-snug text-muted-foreground">
                            This forgets the sign-in the agent saved for this server. The server
                            stays set up; sign in again to connect it, with another account if you
                            like.
                          </p>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => setConfirmingSignOut(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="xs"
                              variant="destructive"
                              disabled={busyServer !== null}
                              onClick={() => void runAction(server, "sign-out")}
                            >
                              Sign out
                            </Button>
                          </div>
                        </div>
                      )
                    ) : null}
                    {waitingForBrowser && signIn ? (
                      <>
                        <p className="text-ui-sm leading-snug text-muted-foreground">
                          Finish signing in in your browser. This updates on its own.{" "}
                          <Button
                            type="button"
                            size="chip"
                            variant="link"
                            className="px-0 align-baseline"
                            onClick={() => openExternalLink(signIn.authUrl)}
                          >
                            Open the sign-in page again
                          </Button>
                        </p>
                        <p className="text-ui-sm leading-snug text-muted-foreground">
                          It connects the account or workspace your browser is signed in to there;
                          to use another, switch it in the browser first.
                        </p>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

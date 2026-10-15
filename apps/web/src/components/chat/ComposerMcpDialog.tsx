// FILE: ComposerMcpDialog.tsx
// Purpose: The `/mcp` view: the active agent's MCP servers as its runtime reports
//          them, with sign-in, reconnect, and enable/disable per server.
// Layer: Chat composer UI
// Exports: ComposerMcpDialog

import { i18n } from "~/i18n";
import type {
  ProviderInstanceId,
  ProviderKind,
  ProviderMcpServerAction,
  ProviderMcpServerDescriptor,
  ProviderMcpServerStatus,
} from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
      return i18n._("Connected");
    case "needs-auth":
      return i18n._("Needs sign-in");
    case "pending":
      return i18n._("Connecting…");
    case "failed":
      return i18n._("Failed");
    case "disabled":
      return i18n._("Disabled");
  }
}

function actionLabel(action: ProviderMcpServerAction): string {
  switch (action) {
    case "authenticate":
      return i18n._("Sign in");
    case "reconnect":
      return i18n._("Reconnect");
    case "enable":
      return i18n._("Enable");
    case "disable":
      return i18n._("Disable");
  }
}

function actionDoneMessage(action: ProviderMcpServerAction, server: string): string {
  switch (action) {
    case "reconnect":
      return i18n._("Reconnected {server}", { server });
    case "enable":
      return i18n._("Enabled {server}", { server });
    case "disable":
      return i18n._("Disabled {server}", { server });
    case "authenticate":
      return i18n._("Signed in to {server}", { server });
  }
}

function scopeLabel(scope: string): string {
  switch (scope) {
    case "user":
      return i18n._("User");
    case "project":
      return i18n._("Project");
    case "local":
      return i18n._("Local");
    case "plugin":
      return i18n._("Plugin");
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
        ? i18n._("1 tool")
        : i18n._("{count} tools", { count: server.toolCount })
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function emptyStateHint(provider: ProviderKind): string {
  return provider === "codex"
    ? i18n._("Add one in Terminal with codex mcp add, then reopen /mcp.")
    : i18n._("Add one in Terminal with claude mcp add, then reopen /mcp.");
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
      if (!requestBase) throw new Error(i18n._("Open a project folder to see MCP servers."));
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
      if (!requestBase || !signIn)
        throw new Error(i18n._("Open a project folder to see MCP servers."));
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
    if (!open) setSignIn(null);
  }, [open]);

  const runAction = async (
    server: ProviderMcpServerDescriptor,
    action: ProviderMcpServerAction,
  ) => {
    if (!requestBase) return;
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
      } else {
        toastManager.add({ type: "success", title: actionDoneMessage(action, server.name) });
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: i18n._("Could not update {server}", { server: server.name }),
        description:
          error instanceof Error ? error.message : i18n._("The agent did not accept the request."),
      });
    } finally {
      setBusyServer(null);
      void serversQuery.refetch();
    }
  };

  const description =
    serversQuery.data?.source === "workspace"
      ? i18n._(
          "No agent session is running in this thread, so this is what a new session in this folder loads.",
        )
      : i18n._("The servers this thread's agent session has loaded.");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader className="pe-12">
          <div className="flex min-w-0 items-center gap-2">
            <DialogTitle className="min-w-0 truncate">{i18n._("MCP servers")}</DialogTitle>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="shrink-0"
              aria-label={i18n._("Refresh")}
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
              {i18n._("Asking the agent for its MCP servers…")}
            </div>
          ) : serversQuery.isError && servers.length === 0 ? (
            <div className="space-y-2 rounded-lg border border-border/60 bg-card p-4">
              <p className="text-ui leading-snug text-foreground">
                {i18n._("Could not read MCP servers")}
              </p>
              <p className="text-ui-sm leading-snug break-words text-muted-foreground">
                {serversQuery.error instanceof Error
                  ? serversQuery.error.message
                  : i18n._("The agent did not answer.")}
              </p>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => void serversQuery.refetch()}
              >
                {i18n._("Try again")}
              </Button>
            </div>
          ) : servers.length === 0 ? (
            <div className="space-y-1 rounded-lg border border-border/60 bg-card p-4">
              <p className="text-ui leading-snug text-foreground">
                {i18n._("No MCP servers are configured.")}
              </p>
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
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          {busy ? (
                            <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
                          ) : null}
                          {server.actions.map((action) => (
                            <Button
                              key={action}
                              type="button"
                              size="xs"
                              variant={action === "authenticate" ? "default" : "outline"}
                              disabled={busy || busyServer !== null}
                              onClick={() => void runAction(server, action)}
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
                    {waitingForBrowser && signIn ? (
                      <p className="text-ui-sm leading-snug text-muted-foreground">
                        {i18n._("Finish signing in in your browser. This updates on its own.")}{" "}
                        <Button
                          type="button"
                          size="chip"
                          variant="link"
                          className="px-0 align-baseline"
                          onClick={() => openExternalLink(signIn.authUrl)}
                        >
                          {i18n._("Open the sign-in page again")}
                        </Button>
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            {i18n._("Close")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

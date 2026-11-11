// FILE: FolderSessionsMenuGroup.tsx
// Purpose: Lattice's history menu section listing the open folder's Claude Code and
//          Codex sessions started in other editors (VS Code, a terminal); choosing one
//          continues it as a chat of this project.
// Layer: Chat presentation
// Depends on: orchestration.listFolderSessions / openFolderSession.

import type { FolderSession, ProjectId, ThreadId } from "@synara/contracts";
import { useEffect, useState } from "react";

import { useTranslation } from "~/i18n";
import { formatRelativeTime } from "~/lib/relativeTime";
import { ensureNativeApi } from "~/nativeApi";
import { ProviderIcon } from "../ProviderIcon";
import { MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator } from "../ui/menu";
import { toastManager } from "../ui/toast";

const FOLDER_SESSIONS_RETRIES = 3;
const FOLDER_SESSIONS_RETRY_MS = 1_000;

export function FolderSessionsMenuGroup(props: {
  projectId: ProjectId;
  /** The menu is open; the folder is scanned each time it opens. */
  open: boolean;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const { t, formatLocale } = useTranslation();
  const [sessions, setSessions] = useState<ReadonlyArray<FolderSession>>([]);
  const { open, projectId, onOpenThread } = props;

  useEffect(() => {
    if (!open) return;
    // A reply for an earlier opening or another project must not land here.
    let current = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) => {
      ensureNativeApi()
        .orchestration.listFolderSessions({ projectId })
        .then(
          (result) => {
            if (current) setSessions(result.sessions);
          },
          () => {
            if (!current) return;
            // The first opening can race the agent service's startup; while the menu stays
            // open, try again. Discovery is a convenience: the menu's own chats work without it.
            if (attempt < FOLDER_SESSIONS_RETRIES) {
              retryTimer = setTimeout(() => load(attempt + 1), FOLDER_SESSIONS_RETRY_MS);
            } else {
              setSessions([]);
            }
          },
        );
    };
    load(0);
    return () => {
      current = false;
      clearTimeout(retryTimer);
    };
  }, [open, projectId]);

  if (sessions.length === 0) return null;

  const openSession = (session: FolderSession) => {
    ensureNativeApi()
      .orchestration.openFolderSession({
        projectId,
        provider: session.provider,
        providerInstanceId: session.providerInstanceId,
        externalId: session.externalId,
      })
      .then(
        (result) => onOpenThread(result.threadId),
        (error: unknown) => {
          toastManager.add({
            type: "error",
            title: t("lattice:couldNotOpenThisSession"),
            description: error instanceof Error ? error.message : String(error),
          });
        },
      );
  };

  return (
    <>
      <MenuSeparator />
      <MenuGroup data-testid="folder-sessions">
        <MenuGroupLabel>{t("lattice:fromOtherEditors")}</MenuGroupLabel>
        {sessions.map((session) => (
          <MenuItem
            key={`${session.provider}:${session.externalId}`}
            data-folder-session={session.externalId}
            onClick={() => openSession(session)}
          >
            <ProviderIcon provider={session.provider} tone="header" className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={session.title || undefined}>
              {session.title || t("lattice:untitledSession")}
            </span>
            <span className="shrink-0 text-ui-xs text-muted-foreground tabular-nums">
              {formatRelativeTime(session.updatedAt, undefined, formatLocale)}
            </span>
          </MenuItem>
        ))}
      </MenuGroup>
    </>
  );
}

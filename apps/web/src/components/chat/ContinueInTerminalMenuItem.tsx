// FILE: ContinueInTerminalMenuItem.tsx
// Purpose: Lattice's history menu item that copies the shell command continuing the
//          active chat's own Codex thread or Claude Code session outside Lattice.
// Layer: Chat presentation
// Depends on: orchestration.getNativeSessionHandoff.
//
// Claude Code hides Agent SDK sessions (every Lattice Claude chat) from its picker, so
// `claude --resume <id>` is the only way back in; the command names the id for Codex too.

import type { NativeSessionHandoff, ThreadId } from "@synara/contracts";
import { useEffect, useState } from "react";

import { useCopyTerminalCommandToClipboard } from "~/hooks/useCopyToClipboard";
import { useTranslation } from "~/i18n";
import { TerminalIcon } from "~/lib/icons";
import { ensureNativeApi } from "~/nativeApi";
import { MenuItem, MenuSeparator } from "../ui/menu";

export function ContinueInTerminalMenuItem(props: {
  threadId: ThreadId;
  /** The menu is open; the chat's native session is looked up each time it opens. */
  open: boolean;
}) {
  const { t } = useTranslation();
  const copyCommand = useCopyTerminalCommandToClipboard();
  const [handoff, setHandoff] = useState<{
    readonly threadId: ThreadId;
    readonly value: NativeSessionHandoff;
  } | null>(null);
  const { open, threadId } = props;

  useEffect(() => {
    if (!open) return;
    // A reply for an earlier opening or another chat must not land here.
    let current = true;
    ensureNativeApi()
      .orchestration.getNativeSessionHandoff({ threadId })
      .then(
        (value) => {
          if (current) setHandoff({ threadId, value });
        },
        () => {
          // A convenience: without an answer the item stays hidden.
          if (current) setHandoff(null);
        },
      );
    return () => {
      current = false;
    };
  }, [open, threadId]);

  const value = handoff?.threadId === threadId ? handoff.value : null;
  // Other agents have no terminal session of their own to continue.
  if (!value || (value.status === "unavailable" && value.reason === "unsupportedProvider")) {
    return null;
  }

  return (
    <>
      <MenuSeparator />
      <MenuItem
        data-testid="continue-in-terminal"
        disabled={value.status !== "available"}
        onClick={() => {
          if (value.status === "available") copyCommand(value.command);
        }}
      >
        <TerminalIcon className="size-3.5 shrink-0 self-start mt-0.5 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span>{t("lattice:continueInTerminal")}</span>
          <span className="text-ui-xs whitespace-normal text-muted-foreground">
            {value.status === "available"
              ? t("lattice:continueInTerminalOutsideLattice")
              : t("lattice:continueInTerminalNoSession")}
          </span>
        </span>
      </MenuItem>
    </>
  );
}

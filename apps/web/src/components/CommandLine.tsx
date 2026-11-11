// FILE: CommandLine.tsx
// Purpose: One copyable terminal command (`brew install gh`, Claude Code's installer), shown
//          where a missing or signed-out CLI blocks a surface.
// Layer: Shared presentation

import { useEffect, useRef, useState } from "react";

import { toastManager } from "~/components/ui/toast";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useTranslation } from "~/i18n";
import { CheckIcon, CopyIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

/** A single copyable terminal command — the `brew install gh` / `gh auth login` affordances. */
export function CommandLine({
  command,
  wrap = false,
}: {
  command: string;
  /** Break a long command across lines instead of cutting it off (narrow panels). */
  wrap?: boolean;
}) {
  const { t } = useTranslation();

  const [copied, setCopied] = useState(false);
  const mountedRef = useRef(true);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        void copyTextToClipboard(command).then(
          () => {
            if (!mountedRef.current) return;
            setCopied(true);
            if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
            resetTimerRef.current = window.setTimeout(() => {
              resetTimerRef.current = null;
              setCopied(false);
            }, 1500);
          },
          (error) => {
            if (!mountedRef.current) return;
            toastManager.add({
              type: "error",
              title: t("git:couldNotCopyCommand"),
              description: error instanceof Error ? error.message : t("git:clipboardAccessFailed"),
            });
          },
        );
      }}
      title={t("chat:messageCopy_copyToClipboard")}
      className="group flex w-full items-center gap-2 rounded-lg border border-border/60 bg-[var(--color-background-elevated-secondary)] px-3 py-2 text-left transition-colors hover:border-border"
    >
      <code
        className={cn(
          "text-ui",
          "min-w-0 flex-1 font-mono text-foreground",
          wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "truncate",
        )}
      >
        {command}
      </code>
      <span
        className={cn(
          "text-ui-sm",
          "flex shrink-0 items-center gap-1 text-muted-foreground transition-colors group-hover:text-foreground",
          copied && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {/* A wrapped command keeps the width for itself; the icon says it all there. */}
        {copied ? (
          <>
            <CheckIcon className="size-3" />{" "}
            <span className={cn(wrap && "sr-only")}>{t("chat:theme_copied")}</span>
          </>
        ) : (
          <>
            <CopyIcon className="size-3" />{" "}
            <span className={cn(wrap && "sr-only")}>{t("workspace:share_copy")}</span>
          </>
        )}
      </span>
    </button>
  );
}

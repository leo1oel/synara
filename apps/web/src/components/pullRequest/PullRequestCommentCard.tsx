// FILE: PullRequestCommentCard.tsx
// Purpose: One review/issue comment as a plain collapsible row (hairline-separated, no card
//          chrome): avatar + author leading, timestamp + per-row collapse chevron trailing,
//          finding-style comments elevated into a title + severity subheading, and a "Reply"
//          affordance that always opens the comment's own GitHub URL externally (falling back
//          to the PR URL when the comment has none) — never the in-app browser, since replying
//          has to happen on GitHub itself.
// Layer: Pull request presentation
// Exports: PullRequestCommentCard

import type { I18n } from "@lingui/core";
import { useLingui } from "@lingui/react";
import type { PullRequestComment } from "@synara/contracts";
import { useState } from "react";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";
import {
  PR_BODY_TEXT_CLASS_NAME,
  PR_FINE_TEXT_CLASS_NAME,
  PR_META_TEXT_CLASS_NAME,
} from "./pullRequestText";
import { ensureNativeApi } from "~/nativeApi";
import { PullRequestActorLabel } from "./PullRequestActorLabel";
import { PullRequestMarkdown } from "./PullRequestMarkdown";
import { parseFindingComment, type PullRequestCommentSeverity } from "./pullRequestComment.logic";

function severityToneClassName(severity: PullRequestCommentSeverity): string {
  if (severity === "High") return "text-destructive";
  if (severity === "Medium") return "text-warning";
  return "text-muted-foreground";
}

function severityLabel(i18n: I18n, severity: PullRequestCommentSeverity): string {
  if (severity === "High") return i18n._("High Severity");
  if (severity === "Medium") return i18n._("Medium Severity");
  return i18n._("Low Severity");
}

export function PullRequestCommentCard({
  comment,
  prUrl,
  workspaceRoot,
  defaultOpen: defaultOpenProp,
}: {
  comment: PullRequestComment;
  prUrl: string;
  workspaceRoot: string;
  /** Long threads start older comments collapsed so the tab doesn't eagerly render
   *  dozens of markdown trees. */
  defaultOpen?: boolean;
}) {
  const { i18n } = useLingui();
  const defaultOpen = defaultOpenProp ?? true;
  const [open, setOpen] = useState(defaultOpen);
  const finding = parseFindingComment(comment.body);
  const replyUrl = comment.url ?? prUrl;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-t border-border/50 first:border-t-0"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-2.5 text-left">
        <PullRequestActorLabel
          actor={comment.author}
          className={cn(PR_META_TEXT_CLASS_NAME, "flex-1 font-medium text-foreground")}
        />
        <span
          className={cn(PR_FINE_TEXT_CLASS_NAME, "shrink-0 tabular-nums text-muted-foreground")}
        >
          {formatRelativeTime(comment.createdAt)}
        </span>
        <DisclosureChevron open={open} />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="pb-3">
          {comment.path ? (
            <span
              className={cn(
                PR_FINE_TEXT_CLASS_NAME,
                "mb-2 block max-w-full truncate text-muted-foreground",
              )}
            >
              {comment.path}
            </span>
          ) : null}
          {finding ? (
            <div className="mb-2">
              <p className={cn(PR_BODY_TEXT_CLASS_NAME, "font-semibold text-foreground")}>
                {finding.title}
              </p>
              <p
                className={cn(
                  PR_META_TEXT_CLASS_NAME,
                  "font-medium",
                  severityToneClassName(finding.severity),
                )}
              >
                {severityLabel(i18n, finding.severity)}
              </p>
            </div>
          ) : null}
          <PullRequestMarkdown
            text={finding ? finding.body : comment.body}
            fallback={`_${i18n._("No review body.")}_`}
            cwd={workspaceRoot}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void ensureNativeApi().shell.openExternal(replyUrl)}
              className={cn(
                PR_META_TEXT_CLASS_NAME,
                "rounded px-1.5 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {i18n._("Reply")}
            </button>
          </div>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

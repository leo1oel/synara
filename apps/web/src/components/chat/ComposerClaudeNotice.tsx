// FILE: ComposerClaudeNotice.tsx
// Purpose: Say a Claude problem right above the composer, in full and with its next
//          step: a calm warning block (no modal), dismissible per problem. The block
//          wraps instead of truncating, so a narrow agent panel still shows the reason.
// Layer: Chat composer UI

import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { useTranslation } from "~/i18n";
import { TriangleAlertIcon, XIcon } from "~/lib/icons";

import type { ClaudeComposerNotice as Notice } from "./claudeComposerNotice";

export function ComposerClaudeNotice(props: {
  readonly notice: Notice;
  readonly onChangeModel: () => void;
  readonly onOpenProviderSettings: () => void;
  readonly onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { notice } = props;
  return (
    <div
      className="mb-2 flex items-start gap-2 rounded-xl border border-warning/32 bg-warning/4 py-2 ps-3 pe-1.5 text-ui"
      role="status"
      data-testid="composer-claude-notice"
      data-notice-kind={notice.kind}
    >
      <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warning" />
      {/* The action sits under the message so a narrow panel keeps the message readable. */}
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <span className="text-[var(--color-text-foreground)]">{notice.message}</span>
        {notice.action ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={
              notice.action === "change-model" ? props.onChangeModel : props.onOpenProviderSettings
            }
          >
            {notice.action === "change-model"
              ? t("chat:providerModelPicker_changeModel")
              : t("lattice:providerSettings")}
          </Button>
        ) : null}
      </span>
      <IconButton
        variant="ghost"
        size="icon-chip"
        className="size-5 shrink-0 rounded-full sm:size-5"
        label={t("chat:dismissTip")}
        onClick={props.onDismiss}
      >
        <XIcon />
      </IconButton>
    </div>
  );
}

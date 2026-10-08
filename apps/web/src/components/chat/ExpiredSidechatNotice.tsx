import { i18n } from "~/i18n";
import { Button } from "~/components/ui/button";

export function ExpiredSidechatNotice({ onStartNew }: { readonly onStartNew: () => void }) {
  return (
    <div
      className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-primary-opaque)] px-3 py-2 text-ui"
      role="status"
    >
      <span className="min-w-0 text-[var(--color-text-foreground-secondary)]">
        {i18n._("This side chat expired after a period of inactivity. Start a new side chat.")}
      </span>
      <Button type="button" variant="outline" size="sm" onClick={onStartNew}>
        {i18n._("Start new")}
      </Button>
    </div>
  );
}

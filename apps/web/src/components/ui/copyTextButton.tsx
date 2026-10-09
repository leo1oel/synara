import { i18n } from "~/i18n";
import { CheckIcon, CopyIcon } from "~/lib/icons";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { Button } from "./button";

/** Shared by toast copy actions and inline diagnostic reports. */
export function CopyTextButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  // Callers pass an already localized noun; only the verb is translated here.
  const title = isCopied ? i18n._("Copied {label}", { label }) : i18n._("Copy {label}", { label });
  return (
    <Button
      aria-label={title}
      title={title}
      className={className}
      size="xs"
      variant="ghost"
      onClick={() => copyToClipboard(text, undefined)}
    >
      {isCopied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      <span>{isCopied ? i18n._("Copied") : title}</span>
    </Button>
  );
}

import { CheckIcon, CopyIcon } from "~/lib/icons";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { Button } from "./button";
import { t, useTranslation } from "~/i18n";

/** Shared by toast copy actions and inline diagnostic reports. */
export function CopyTextButton({
  text,
  label,
  className,
  iconOnly = false,
}: {
  text: string;
  label: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const { t } = useTranslation();

  const { copyToClipboard, isCopied } = useCopyToClipboard();
  // Callers pass an already localized noun; only the verb is translated here.
  const title = isCopied
    ? t("common:copied", { value0: label })
    : t("settings:copy", { value0: label });
  return (
    <Button
      aria-label={title}
      title={title}
      className={className}
      size={iconOnly ? "icon-xs" : "xs"}
      variant="ghost"
      onClick={() => copyToClipboard(text, undefined)}
    >
      {isCopied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      {iconOnly ? null : <span>{isCopied ? t("chat:theme_copied") : title}</span>}
    </Button>
  );
}

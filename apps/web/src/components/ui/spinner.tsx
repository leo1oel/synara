import { i18n } from "~/i18n";
import { Loader2Icon } from "~/lib/icons";
import { cn } from "~/lib/utils";

function Spinner({ className, ...props }: React.ComponentProps<typeof Loader2Icon>) {
  return (
    <Loader2Icon
      aria-label={i18n._("Loading")}
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}

export { Spinner };

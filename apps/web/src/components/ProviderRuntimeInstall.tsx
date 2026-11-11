import { t } from "~/i18n";

import {
  PROVIDER_DISPLAY_NAMES,
  type ServerProviderRuntimeInstall,
  type ServerProviderStatus,
} from "@synara/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type MouseEvent } from "react";

import { DownloadIcon, Loader2Icon } from "~/lib/icons";
import { reconcileServerProviderStatuses } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { Button } from "./ui/button";

type RuntimeProvider = "pi" | "opencode";

/** The install state of a provider whose runtime is not on this machine; null otherwise. */
export function providerRuntimeInstallOf(
  status: ServerProviderStatus | undefined | null,
): (ServerProviderRuntimeInstall & { readonly provider: RuntimeProvider }) | null {
  const provider = status?.driver ?? status?.provider;
  if (!status?.runtimeInstall || (provider !== "pi" && provider !== "opencode")) return null;
  return { ...status.runtimeInstall, provider };
}

export function providerRuntimeInstallPercent(install: ServerProviderRuntimeInstall): number {
  const total = install.totalPackages ?? 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.round(((install.completedPackages ?? 0) / total) * 100));
}

export function providerRuntimeInstallLabel(
  translate: typeof t,
  install: ServerProviderRuntimeInstall,
): string {
  if (install.status === "installing") {
    return translate("lattice:installing", { percent: providerRuntimeInstallPercent(install) });
  }
  return install.status === "failed"
    ? translate("lattice:installFailed")
    : translate("onboarding:notInstalled");
}

export function providerRuntimeInstallFailureMessage(
  translate: typeof t,
  install: ServerProviderRuntimeInstall,
): string {
  switch (install.failure) {
    case "offline":
      return translate("lattice:couldNotReachThePackageRegistryCheck");
    case "integrity":
      return translate("lattice:aDownloadedPackageDidNotMatchIts");
    case "disk":
      return translate("lattice:couldNotWriteTheFilesCheckThat");
    case "verify":
      return translate("lattice:theDownloadedPackagesDidNotLoadSo");
    default:
      return translate("lattice:theDownloadDidNotCompleteSoNothing");
  }
}

function useInstallProviderRuntime() {
  const queryClient = useQueryClient();
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const install = (provider: RuntimeProvider) => {
    if (requesting) return;
    setRequesting(true);
    setRequestError(null);
    ensureNativeApi()
      .server.installProviderRuntime({ provider })
      .then((result) => reconcileServerProviderStatuses(queryClient, result.providers))
      .catch((error: unknown) =>
        setRequestError(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setRequesting(false));
  };
  return { install, requesting, requestError };
}

/** The install (or retry) button; a spinner with the progress while the install runs. */
export function ProviderRuntimeInstallButton(props: {
  readonly status: ServerProviderStatus;
  readonly className?: string;
}) {
  const { install, requesting } = useInstallProviderRuntime();
  const runtime = providerRuntimeInstallOf(props.status);
  if (!runtime) return null;
  const installing = runtime.status === "installing" || requesting;
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      disabled={installing}
      className={cn("shrink-0", props.className)}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        install(runtime.provider);
      }}
    >
      {installing ? (
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : (
        <DownloadIcon className="size-3.5" />
      )}
      {installing
        ? t("lattice:installing2")
        : runtime.status === "failed"
          ? t("chat:profile_tryAgain")
          : t("settings:providers_docInstall")}
    </Button>
  );
}

/**
 * Explains why the provider is not installed and offers the install, then shows its
 * progress or why it failed. Wraps at any width: every line may break, and the button
 * moves under the text when the panel is narrow.
 */
export function ProviderRuntimeInstallPanel(props: {
  readonly status: ServerProviderStatus;
  /** The picker centers its setup panel; settings align with the rows around it. */
  readonly align?: "center" | "start";
  /** False where the install button already sits beside the panel (a settings row). */
  readonly showAction?: boolean;
}) {
  const { install, requesting, requestError } = useInstallProviderRuntime();
  const runtime = providerRuntimeInstallOf(props.status);
  if (!runtime) return null;
  const name = PROVIDER_DISPLAY_NAMES[runtime.provider];
  const installing = runtime.status === "installing" || requesting;
  const centered = props.align === "center";
  const percent = providerRuntimeInstallPercent(runtime);
  return (
    <div
      data-slot="provider-runtime-install"
      className={cn(
        "flex min-w-0 flex-col gap-2 text-ui-sm leading-snug [overflow-wrap:anywhere]",
        centered ? "items-center text-center" : "items-start text-left",
      )}
    >
      <span className="text-muted-foreground">
        {t("lattice:isDownloadedSeparatelyToKeepTheApp", { provider: name })}
      </span>
      {runtime.status === "installing" ? (
        <div className="flex w-full min-w-0 flex-col gap-1" role="status">
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={t("lattice:installing3", { provider: name })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className="h-full rounded-full bg-foreground/70 transition-[width] duration-200 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-muted-foreground tabular-nums">
            {t("lattice:installingOfPackages", {
              provider: name,
              completed: runtime.completedPackages ?? 0,
              total: runtime.totalPackages ?? 0,
            })}
          </span>
        </div>
      ) : null}
      {runtime.status === "failed" || requestError ? (
        <span role="alert" className="text-destructive">
          {runtime.status === "failed"
            ? providerRuntimeInstallFailureMessage(t, runtime)
            : requestError}
        </span>
      ) : null}
      {runtime.status === "installing" || props.showAction === false ? null : (
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={installing}
          className="max-w-full"
          onClick={() => install(runtime.provider)}
        >
          {installing ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <DownloadIcon className="size-3.5" />
          )}
          <span className="truncate">
            {runtime.status === "failed"
              ? t("chat:profile_tryAgain")
              : t("lattice:install", { provider: name })}
          </span>
        </Button>
      )}
    </div>
  );
}

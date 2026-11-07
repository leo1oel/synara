import { useAppSettings } from "~/appSettings";
import { CommandLine } from "~/components/CommandLine";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { GitPullRequestIcon, TriangleAlertIcon } from "~/lib/icons";
import { isPullRequestsUnavailableError } from "~/lib/pullRequestErrors";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { formatShortTimestamp } from "~/timestampFormat";
import { PR_META_TEXT_CLASS_NAME } from "./pullRequestText";
import { t, useTranslation } from "~/i18n";

function githubCliInstallCommand(platform: string): string | null {
  if (/mac/i.test(platform)) return "brew install gh";
  if (/win/i.test(platform)) return "winget install --id GitHub.cli";
  return null;
}

export function PullRequestsUnavailableState({
  error,
  onRetry,
  subject: subjectProp,
}: {
  error: unknown;
  /** Optional refetch hook so "Retry" re-runs the failed query instead of reloading the app. */
  onRetry?: () => void;
  /** What failed to load, as a plural noun for the title ("Pull requests are unavailable"),
   *  already in the UI language. */
  subject?: string;
}) {
  const { t, formatLocale } = useTranslation();

  const subject = subjectProp ?? "Pull requests";
  const { settings } = useAppSettings();
  const unavailable = isPullRequestsUnavailableError(error) ? error : null;
  const notInstalled = unavailable?.reason === "gh-not-installed";
  const notAuthenticated = unavailable?.reason === "gh-not-authenticated";
  const rateLimited = unavailable?.reason === "rate-limited";
  const resetTime =
    rateLimited && unavailable?.retryAt
      ? formatShortTimestamp(unavailable.retryAt, settings.timestampFormat, formatLocale)
      : null;
  const installCommand =
    notInstalled && typeof navigator !== "undefined"
      ? githubCliInstallCommand(navigator.platform)
      : null;

  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitPullRequestIcon />
        </EmptyMedia>
        <EmptyTitle>
          {notInstalled
            ? t("git:gitHubCLIIsRequired")
            : notAuthenticated
              ? t("git:signInToGitHubCLI")
              : rateLimited
                ? t("git:gitHubRateLimitReached")
                : t("git:areUnavailable", { value0: subject })}
        </EmptyTitle>
        <EmptyDescription>
          {notInstalled
            ? t("git:synaraReadsGitHubDataOnlyThroughTheGhCLI")
            : notAuthenticated
              ? t("git:authenticateTheGitHubCLIInATerminalThenRetry")
              : rateLimited
                ? resetTime
                  ? t("git:synaraPausesGitHubRequestsUntilTheLimitResetsAt", { value0: resetTime })
                  : t("git:synaraPausesGitHubRequestsUntilTheLimitResets")
                : error instanceof Error
                  ? error.message
                  : t("git:theRequestToGitHubFailed")}
        </EmptyDescription>
      </EmptyHeader>
      {notInstalled || notAuthenticated ? (
        <EmptyContent>
          {notAuthenticated ? <CommandLine command="gh auth login" /> : null}
          {installCommand ? <CommandLine command={installCommand} /> : null}
          <div className="flex w-full items-center gap-2">
            {notInstalled ? (
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => void ensureNativeApi().shell.openExternal("https://cli.github.com/")}
              >
                {t("git:installInstructions")}
              </Button>
            ) : null}
            {onRetry && !unavailable ? (
              <Button
                variant={notInstalled ? "ghost" : "outline"}
                size="sm"
                className="flex-1"
                onClick={onRetry}
              >
                {t("common:common_retry")}
              </Button>
            ) : null}
          </div>
        </EmptyContent>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div
            className={cn(
              PR_META_TEXT_CLASS_NAME,
              "flex items-center gap-1.5 text-muted-foreground",
            )}
          >
            <TriangleAlertIcon className="size-3.5" />
            <span>
              {rateLimited
                ? t("git:theListRefreshesOnItsOwnOnceTheLimit")
                : t("git:checkYourConnectionAndTryAgain")}
            </span>
          </div>
          {onRetry && !unavailable ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t("common:common_retry")}
            </Button>
          ) : null}
        </div>
      )}
    </Empty>
  );
}

import { i18n } from "~/i18n";
import type { ResolvedThreadWorkspaceState } from "@synara/shared/threadEnvironment";
import type { ProviderInteractionMode } from "@synara/contracts";
import type { DraftThreadEnvMode } from "../../composerDraftStore";
import {
  type ContextWindowSnapshot,
  formatContextWindowTokens,
  formatCostUsd,
} from "../../lib/contextWindow";
import type { RateLimitStatus } from "./RateLimitBanner";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { ContextWindowMeter } from "./ContextWindowMeter";

function formatRateLimitMessage(rateLimitStatus: RateLimitStatus): string {
  const resetSuffix = rateLimitStatus.resetsAt
    ? ` Resets at ${new Date(rateLimitStatus.resetsAt).toLocaleTimeString()}.`
    : "";
  if (rateLimitStatus.status === "rejected") {
    return `Rate limit reached.${resetSuffix}`;
  }
  const utilizationSuffix =
    typeof rateLimitStatus.utilization === "number"
      ? ` (${Math.round(rateLimitStatus.utilization * 100)}% used)`
      : "";
  return `Approaching rate limit${utilizationSuffix}.${resetSuffix}`;
}

function formatEnvironmentLabel(
  envMode: DraftThreadEnvMode,
  envState: ResolvedThreadWorkspaceState,
): string {
  if (envMode === "local") {
    return i18n._("Local");
  }
  return envState === "worktree-pending" ? i18n._("New worktree (pending)") : i18n._("Worktree");
}

export function ComposerSlashStatusDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedModel: string | null | undefined;
  fastModeEnabled: boolean;
  selectedPromptEffort: string | null;
  interactionMode: ProviderInteractionMode;
  envMode: DraftThreadEnvMode;
  envState: ResolvedThreadWorkspaceState;
  branch: string | null;
  contextWindow: ContextWindowSnapshot | null;
  cumulativeCostUsd: number | null;
  rateLimitStatus: RateLimitStatus | null;
  activeContextWindowLabel?: string | null;
  pendingContextWindowLabel?: string | null;
}) {
  const {
    open,
    onOpenChange,
    selectedModel,
    fastModeEnabled,
    selectedPromptEffort,
    interactionMode,
    envMode,
    envState,
    branch,
    contextWindow,
    cumulativeCostUsd,
    rateLimitStatus,
    activeContextWindowLabel,
    pendingContextWindowLabel,
  } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{i18n._("Session Status")}</DialogTitle>
          <DialogDescription>
            {i18n._("Runtime controls and local thread state for the active composer.")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 text-ui-lg leading-snug sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-ui leading-snug text-muted-foreground">{i18n._("Model")}</p>
              <p className="font-medium text-foreground">{selectedModel}</p>
            </div>
            <div className="space-y-1">
              <p className="text-ui leading-snug text-muted-foreground">{i18n._("Fast Mode")}</p>
              <p className="font-medium text-foreground">
                {fastModeEnabled ? i18n._("On") : i18n._("Off")}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-ui leading-snug text-muted-foreground">{i18n._("Reasoning")}</p>
              <p className="font-medium text-foreground">
                {selectedPromptEffort ?? i18n._("Default")}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-ui leading-snug text-muted-foreground">{i18n._("Mode")}</p>
              <p className="font-medium text-foreground">
                {interactionMode === "plan"
                  ? i18n._("Plan")
                  : interactionMode === "debug"
                    ? i18n._("Debug")
                    : i18n._("Default")}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-ui leading-snug text-muted-foreground">{i18n._("Environment")}</p>
              <p className="font-medium text-foreground">
                {formatEnvironmentLabel(envMode, envState)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-ui leading-snug text-muted-foreground">{i18n._("Branch")}</p>
              <p className="font-medium text-foreground">{branch ?? i18n._("Unknown")}</p>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border/60 bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-ui leading-snug text-muted-foreground">
                  {i18n._("Context Window")}
                </p>
                <p className="text-ui leading-snug text-muted-foreground">
                  {i18n._("Latest usage reported by the active thread.")}
                </p>
                {pendingContextWindowLabel ? (
                  <p className="text-ui leading-snug text-muted-foreground">
                    Current session: {activeContextWindowLabel ?? i18n._("Unknown")}. Next turn:{" "}
                    {pendingContextWindowLabel}.
                  </p>
                ) : null}
              </div>
              {contextWindow ? (
                <ContextWindowMeter
                  usage={contextWindow}
                  cumulativeCostUsd={cumulativeCostUsd}
                  activeWindowLabel={activeContextWindowLabel}
                  pendingWindowLabel={pendingContextWindowLabel}
                />
              ) : null}
            </div>
            <div className="grid gap-3 text-ui-lg leading-snug sm:grid-cols-2">
              {contextWindow ? (
                <>
                  <div>
                    <p className="text-muted-foreground">{i18n._("Used")}</p>
                    <p className="font-medium text-foreground">
                      {formatContextWindowTokens(contextWindow.usedTokens)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{i18n._("Remaining")}</p>
                    <p className="font-medium text-foreground">
                      {formatContextWindowTokens(contextWindow.remainingTokens)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{i18n._("Window")}</p>
                    <p className="font-medium text-foreground">
                      {formatContextWindowTokens(contextWindow.maxTokens)}
                    </p>
                  </div>
                </>
              ) : (
                <div>
                  <p className="text-muted-foreground">{i18n._("Context usage")}</p>
                  <p className="font-medium text-foreground">{i18n._("Not reported yet")}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground">{i18n._("Cost")}</p>
                <p className="font-medium text-foreground">
                  {cumulativeCostUsd !== null
                    ? formatCostUsd(cumulativeCostUsd)
                    : i18n._("Not available")}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border/60 bg-card p-4">
            <p className="text-ui leading-snug text-muted-foreground">{i18n._("Rate Limits")}</p>
            {rateLimitStatus ? (
              <p className="text-ui leading-snug text-foreground">
                {formatRateLimitMessage(rateLimitStatus)}
              </p>
            ) : (
              <p className="text-ui leading-snug text-muted-foreground">
                {i18n._("No active rate-limit warning for this thread.")}
              </p>
            )}
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            {i18n._("Close")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

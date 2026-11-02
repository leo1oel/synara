import { t } from "~/i18n";
// FILE: _chat.source-control.tsx
// Purpose: Render Synara source control as a dedicated Lattice embed surface.
// Layer: Route screen

import { createFileRoute } from "@tanstack/react-router";

import { GitPanel } from "../components/chat/GitPanel";
import { useEmbedReadySignal } from "../hooks/useEmbedReadySignal";
import { useEmbeddedWorkspaceProject } from "../hooks/useEmbeddedWorkspaceProject";

function SourceControlRouteView() {
  const { embedMode, projectId, bindingError } = useEmbeddedWorkspaceProject();
  useEmbedReadySignal(embedMode);

  if (!embedMode) {
    return (
      <div className="grid h-svh place-items-center bg-background px-6 text-ui text-muted-foreground">
        {t("lattice:sourceControlEmbedModeRequiresALattice")}
      </div>
    );
  }

  return (
    <div className="h-svh min-h-0 w-full bg-background text-[var(--color-text-foreground)]">
      {bindingError ? (
        <div className="absolute inset-x-3 top-11 z-50 rounded-md border border-destructive/30 bg-background/95 px-3 py-2 text-ui-xs text-destructive shadow">
          {t("lattice:projectBindingFailed", { error: bindingError })}
        </div>
      ) : null}
      <GitPanel
        hostThreadId={null}
        projectId={projectId}
        cwdOverride={embedMode.workspaceRoot}
        showActions
        title={t("git:panel_changes")}
      />
    </div>
  );
}

export const Route = createFileRoute("/_chat/source-control")({
  component: SourceControlRouteView,
});

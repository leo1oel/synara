// FILE: _chat.source-control.tsx
// Purpose: Render Synara source control as a dedicated Lattice embed surface.
// Layer: Route screen

import { createFileRoute } from "@tanstack/react-router";
import { useLingui } from "@lingui/react";

import { GitPanel } from "../components/chat/GitPanel";
import { useEmbeddedWorkspaceProject } from "../hooks/useEmbeddedWorkspaceProject";

function SourceControlRouteView() {
  const { i18n } = useLingui();
  const { embedMode, projectId, bindingError } = useEmbeddedWorkspaceProject();

  if (!embedMode) {
    return (
      <div className="grid h-svh place-items-center bg-background px-6 text-sm text-muted-foreground">
        {i18n._("Source control embed mode requires a Lattice workspace.")}
      </div>
    );
  }

  return (
    <div className="h-svh min-h-0 w-full bg-background text-[var(--color-text-foreground)]">
      {bindingError ? (
        <div className="absolute inset-x-3 top-11 z-50 rounded-md border border-destructive/30 bg-background/95 px-3 py-2 text-xs text-destructive shadow">
          {i18n._("Project binding failed: {error}", { error: bindingError })}
        </div>
      ) : null}
      <GitPanel
        hostThreadId={null}
        projectId={projectId}
        cwdOverride={embedMode.workspaceRoot}
        showActions
        title={i18n._("Changes")}
      />
    </div>
  );
}

export const Route = createFileRoute("/_chat/source-control")({
  component: SourceControlRouteView,
});

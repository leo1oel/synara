// FILE: _chat.source-control.tsx
// Purpose: Render Synara source control as a dedicated Lattice embed surface.
// Layer: Route screen

import { type ProjectId } from "@synara/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { GitPanel } from "../components/chat/GitPanel";
import { readEmbedMode } from "../embedMode";
import { createOrRecoverProjectFromPath } from "../lib/projectCreation";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";

function SourceControlRouteView() {
  const embedMode = readEmbedMode();
  const matchingProject = useStore((store) =>
    embedMode
      ? store.projects.find((project) => project.cwd === embedMode.workspaceRoot) ?? null
      : null,
  );
  const [projectId, setProjectId] = useState<ProjectId | null>(matchingProject?.id ?? null);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const bindingStartedRef = useRef(false);

  useEffect(() => {
    if (!embedMode || matchingProject || bindingStartedRef.current) return;
    bindingStartedRef.current = true;
    const api = readNativeApi();
    if (!api) {
      setBindingError("Synara server connection is unavailable.");
      return;
    }
    void (async () => {
      try {
        const initialSnapshot = await api.orchestration.getShellSnapshot();
        useStore.getState().syncServerShellSnapshot(initialSnapshot);
        const result = await createOrRecoverProjectFromPath({
          api,
          workspaceRoot: embedMode.workspaceRoot,
          loadSnapshot: () => api.orchestration.getShellSnapshot(),
        });
        if (result.snapshot) useStore.getState().syncServerShellSnapshot(result.snapshot);
        setProjectId(result.projectId);
      } catch (error) {
        setBindingError(
          error instanceof Error ? error.message : "The Lattice project could not be bound.",
        );
      }
    })();
  }, [embedMode, matchingProject]);

  useEffect(() => {
    if (matchingProject) setProjectId(matchingProject.id);
  }, [matchingProject]);

  if (!embedMode) {
    return (
      <div className="grid h-svh place-items-center bg-background px-6 text-sm text-muted-foreground">
        Source control embed mode requires a Lattice workspace.
      </div>
    );
  }

  return (
    <div className="h-svh min-h-0 w-full bg-background text-foreground">
      {bindingError ? (
        <div className="absolute inset-x-3 top-11 z-50 rounded-md border border-destructive/30 bg-background/95 px-3 py-2 text-xs text-destructive shadow">
          Project binding failed: {bindingError}
        </div>
      ) : null}
      <GitPanel
        hostThreadId={null}
        projectId={projectId}
        cwdOverride={embedMode.workspaceRoot}
        showActions
        onClose={() => window.parent.postMessage({ type: "lattice:close-source-control" }, "*")}
      />
    </div>
  );
}

export const Route = createFileRoute("/_chat/source-control")({
  component: SourceControlRouteView,
});

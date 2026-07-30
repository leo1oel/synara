import type { ProjectId } from "@synara/contracts";
import { useEffect, useRef, useState } from "react";

import { embedWorkspaceMatches, readEmbedMode } from "../embedMode";
import { createOrRecoverProjectFromPath } from "../lib/projectCreation";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";

export function useEmbeddedWorkspaceProject(): {
  embedMode: ReturnType<typeof readEmbedMode>;
  projectId: ProjectId | null;
  bindingError: string | null;
} {
  const embedMode = readEmbedMode();
  const workspaceRoot = embedMode?.workspaceRoot ?? null;
  const matchingProject = useStore((store) =>
    embedMode
      ? store.projects.find((project) =>
          embedWorkspaceMatches(embedMode, project.cwd),
        ) ?? null
      : null,
  );
  const [projectId, setProjectId] = useState<ProjectId | null>(
    matchingProject?.id ?? null,
  );
  const [bindingError, setBindingError] = useState<string | null>(null);
  const bindingStartedRootRef = useRef<string | null>(null);

  useEffect(() => {
    if (!workspaceRoot || matchingProject) return;
    if (bindingStartedRootRef.current === workspaceRoot) return;
    bindingStartedRootRef.current = workspaceRoot;
    const api = readNativeApi();
    if (!api) {
      setBindingError("The local Agent connection is unavailable.");
      return;
    }
    void (async () => {
      try {
        const initialSnapshot = await api.orchestration.getShellSnapshot();
        useStore.getState().syncServerShellSnapshot(initialSnapshot);
        const result = await createOrRecoverProjectFromPath({
          api,
          workspaceRoot,
          loadSnapshot: () => api.orchestration.getShellSnapshot(),
        });
        if (result.snapshot) {
          useStore.getState().syncServerShellSnapshot(result.snapshot);
        }
        setProjectId(result.projectId);
        setBindingError(null);
      } catch (error) {
        setBindingError(
          error instanceof Error
            ? error.message
            : "The Lattice project could not be bound.",
        );
      }
    })();
  }, [matchingProject, workspaceRoot]);

  useEffect(() => {
    if (matchingProject) {
      setProjectId(matchingProject.id);
      setBindingError(null);
    }
  }, [matchingProject]);

  return { embedMode, projectId, bindingError };
}

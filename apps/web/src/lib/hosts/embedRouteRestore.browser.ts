// Lattice embeds several frames of the app in one tab (the Agent panel, the Git
// drawer's views, Settings pages). They share one sessionStorage, so the route one
// frame last visited must not replace the route another frame was opened on.
import { afterEach, expect, it, vi } from "vitest";
import { EnvironmentId } from "@synara/contracts";

const environmentId = EnvironmentId.makeUnsafe(`fixture-${crypto.randomUUID()}`);
const descriptor = {
  environmentId,
  label: "Controller",
  platform: { os: "darwin" as const, arch: "arm64" as const },
  serverVersion: "1",
  capabilities: { repositoryIdentity: true },
};
const startingUrl = window.location.href;

async function bootHistory(embedded: boolean, ownRoute: string, rememberedRoute: string) {
  vi.doMock("../../embedMode", () => ({ isSynaraEmbedMode: () => embedded }));
  const { initializeExecutionContext } = await import("./executionContext");
  initializeExecutionContext({ controller: descriptor, execution: descriptor, remote: null });
  const { executionSessionStorage } = await import("./executionStorage");
  executionSessionStorage.setItem("last-route:v1", rememberedRoute);
  // A freshly opened frame: no history state from an earlier document.
  window.history.replaceState(null, "", ownRoute);
  const { appHistory } = await import("../../appNavigation");
  return { appHistory, executionSessionStorage };
}

// The browser runner keeps one module instance per file, so the history boots once.
afterEach(() => {
  vi.doUnmock("../../embedMode");
  sessionStorage.clear();
  window.history.replaceState(null, "", startingUrl);
});

it("keeps an embedded frame on the route it was opened on", async () => {
  const drawer = "/thread-1?embed=1&surface=drawer&turnId=turn-1";
  const { appHistory, executionSessionStorage } = await bootHistory(
    true,
    drawer,
    "/thread-1?embed=1&surface=chrome",
  );
  expect(appHistory.location.href).toBe(drawer);
  appHistory.push("/thread-1?embed=1&surface=drawer&turnId=turn-2");
  // Nor does the frame leave its route for a sibling frame to restore.
  expect(executionSessionStorage.getItem("last-route:v1")).toBe("/thread-1?embed=1&surface=chrome");
});

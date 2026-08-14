import { readEmbedMode } from "./embedMode";

export const LATTICE_AGENT_COMPILE_RESULT = "lattice:agent-compile-result";
const COMPILE_RESULT_PATH = "/api/lattice/agent-quality/compile-result";

function readAuthToken(): string | null {
  return sessionStorage.getItem("synara.poc.embed-auth-token")?.trim() || null;
}

function isCompileResult(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const diagnostics = result.diagnostics;
  const allowedKeys = new Set([
    "type",
    "version",
    "threadId",
    "turnId",
    "checkpointRef",
    "compiledAt",
    "success",
    "durationMs",
    "rootDocument",
    "diagnostics",
  ]);
  return (
    Object.keys(result).every((key) => allowedKeys.has(key)) &&
    result.type === LATTICE_AGENT_COMPILE_RESULT &&
    result.version === 1 &&
    typeof result.threadId === "string" &&
    result.threadId.length > 0 &&
    typeof result.turnId === "string" &&
    result.turnId.length > 0 &&
    typeof result.checkpointRef === "string" &&
    result.checkpointRef.length > 0 &&
    typeof result.compiledAt === "string" &&
    typeof result.success === "boolean" &&
    (result.durationMs === null || typeof result.durationMs === "number") &&
    (result.rootDocument === null || typeof result.rootDocument === "string") &&
    !!diagnostics &&
    typeof diagnostics === "object" &&
    !Array.isArray(diagnostics) &&
    Object.keys(diagnostics).every((key) => key === "errors" || key === "warnings") &&
    typeof (diagnostics as Record<string, unknown>).errors === "number" &&
    typeof (diagnostics as Record<string, unknown>).warnings === "number"
  );
}

export function startLatticeAgentQualityRelay(): () => void {
  const config = readEmbedMode();
  const token = readAuthToken();
  if (!config?.hostOrigin || !token || window.parent === window) return () => undefined;
  const controller = new AbortController();
  const onMessage = (event: MessageEvent) => {
    if (
      event.source !== window.parent ||
      event.origin !== config.hostOrigin ||
      !isCompileResult(event.data)
    ) {
      return;
    }
    void fetch(COMPILE_RESULT_PATH, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(event.data),
      cache: "no-store",
      signal: controller.signal,
    }).catch(() => undefined);
  };
  window.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener("message", onMessage);
    controller.abort();
  };
}

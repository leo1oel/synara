import { readEmbeddedHostAuthToken, readEmbedMode } from "./embedMode";

// Lattice posts the project files it wrote itself (a co-author's edit synced
// or streamed from Overleaf, the user's own save). The server records them on
// the turn that was running, so checkpoint Undo refuses to reverse an edit
// that landed inside the agent's diff instead of deleting it. The server
// validates the body; this relay only checks the envelope and forwards it.
export const LATTICE_HOST_FILE_WRITES = "lattice:host-file-writes";
const HOST_FILE_WRITES_PATH = "/api/lattice/host-file-writes";
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;

const isHostFileWrites = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (value as Record<string, unknown>).type === LATTICE_HOST_FILE_WRITES &&
  (value as Record<string, unknown>).version === 1 &&
  Array.isArray((value as Record<string, unknown>).writes);

export function startLatticeHostWritesRelay(): () => void {
  const config = readEmbedMode();
  const token = readEmbeddedHostAuthToken();
  if (!config?.hostOrigin || !token || window.parent === window) return () => undefined;
  const controller = new AbortController();
  // A lost report lets Undo delete the edit it describes, so a transient
  // failure (the server busy, a dropped connection) is retried a few times.
  const send = async (body: string) => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const response = await fetch(HOST_FILE_WRITES_PATH, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
        cache: "no-store",
        signal: controller.signal,
      }).catch(() => null);
      if (response?.ok || response?.status === 400 || controller.signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  };
  const onMessage = (event: MessageEvent) => {
    if (
      event.source !== window.parent ||
      event.origin !== config.hostOrigin ||
      !isHostFileWrites(event.data)
    ) {
      return;
    }
    void send(JSON.stringify(event.data));
  };
  window.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener("message", onMessage);
    controller.abort();
  };
}

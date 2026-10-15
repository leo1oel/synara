// FILE: runtimeDependencySmoke.ts
// Purpose: Exercises lazy runtime imports inside the packaged app without starting provider sessions.
// Layer: Release verification entrypoint

import { strict as assert } from "node:assert";

import { loadAcpSdk } from "./provider/acp/AcpSdk.ts";
import { loadClaudeAgentSdk } from "./provider/claudeAgentSdk.ts";
import {
  loadProviderRuntimeModule,
  providerRuntimeAvailability,
  ProviderRuntimeMissingError,
} from "./provider/providerRuntimes.ts";

// Keep these imports external, just like the server. Running this entrypoint
// from app.asar exposes missing peers that the development install can hide.
await loadAcpSdk();
await loadClaudeAgentSdk();
// Pi and OpenCode are optional runtimes: a full install loads them here, while a slim
// host that leaves them out must report them as installable, not crash.
for (const runtime of ["pi", "opencode"] as const) {
  const availability = providerRuntimeAvailability(runtime);
  const specifier =
    runtime === "pi" ? "@earendil-works/pi-coding-agent" : ("@opencode-ai/sdk/v2" as const);
  if (availability === "missing") {
    await assert.rejects(loadProviderRuntimeModule(specifier), ProviderRuntimeMissingError);
  } else {
    await loadProviderRuntimeModule(specifier);
  }
  console.log(`Provider runtime ${runtime}: ${availability}.`);
}
await import("open");
await import("node-pty");
await import("@xterm/headless");
// Connectors (Beta) load the MCP SDK's OAuth client on first use.
await import("@modelcontextprotocol/sdk/client/auth.js");

const { parsePatchFiles } = await import("@pierre/diffs");
const patches = parsePatchFiles(
  "diff --git a/smoke.txt b/smoke.txt\n--- a/smoke.txt\n+++ b/smoke.txt\n@@ -1 +1 @@\n-before\n+after\n",
);
assert.equal(patches[0]?.files[0]?.name, "smoke.txt");
console.log("Packaged runtime dependency smoke passed.");

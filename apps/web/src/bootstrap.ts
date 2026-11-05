// FILE: bootstrap.ts
// Purpose: Completes synchronous renderer storage migration before any app store can hydrate.

import "./storageOriginMigration";

import { bootstrapSignedOutScreen } from "./authSignedOut";
import { initializeEmbedMode } from "./embedMode";
import { restoreLatticeEmbedStorage } from "./latticeEmbedStorage";
import { bootstrapPairingSession } from "./pairingBootstrap";

if (!bootstrapSignedOutScreen()) {
  // Lattice's handshake carries the token the storage restore needs, and the
  // restore must land before main's imports hydrate the stores. main.tsx runs
  // initializeEmbedMode again; a second pass keeps the remembered handshake.
  initializeEmbedMode();
  void restoreLatticeEmbedStorage()
    // A failed restore only costs this launch its saved state; it must not stop the boot.
    .catch(() => undefined)
    .then(() => bootstrapPairingSession())
    .then((result) => {
      if (result === "not-pairing") {
        return import("./main");
      }
    });
}

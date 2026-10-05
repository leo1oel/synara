// FILE: useEmbedReadySignal.ts
// Purpose: Tell the embedding Lattice parent that an embed surface has rendered, so it can
//          drop its own loading shell. Surfaces show their own skeletons from here on.
// Layer: UI hook over embedMode's postMessage contract.

import { useEffect } from "react";

import { type EmbedModeConfig, postEmbedReadyToLattice } from "../embedMode";

/** Posts `synara:embed-ready` once per mount after the surface's first commit. */
export function useEmbedReadySignal(embedMode: EmbedModeConfig | null): void {
  useEffect(() => {
    if (embedMode) postEmbedReadyToLattice(embedMode);
  }, [embedMode]);
}

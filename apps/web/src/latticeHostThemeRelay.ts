import { applyEmbedHostTheme, readEmbedMode } from "./embedMode";
import { LATTICE_REQUEST_HOST_THEME, parseLatticeHostTheme } from "./latticeHostTheme";

/**
 * Follow Lattice's tint, accent, and translucency (`lattice:host-theme`).
 * Each message only rewrites root custom properties, so bursts from a dragged
 * custom accent apply directly; an animation-frame queue would stall while the
 * host keeps this frame hidden.
 */
export function startLatticeHostThemeRelay(): () => void {
  const config = readEmbedMode();
  if (!config?.hostOrigin || window.parent === window) return () => undefined;
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== config.hostOrigin) return;
    const hostTheme = parseLatticeHostTheme(event.data, config.theme);
    if (hostTheme) applyEmbedHostTheme(config, hostTheme);
  };
  window.addEventListener("message", onMessage);
  // Lattice also posts the palette after every `synara:embed-ready`; asking
  // here covers a palette change that raced this frame's start-up.
  window.parent.postMessage({ type: LATTICE_REQUEST_HOST_THEME }, config.hostOrigin);
  return () => window.removeEventListener("message", onMessage);
}

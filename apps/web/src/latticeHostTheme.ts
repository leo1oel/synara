// Lattice's embed palette contract (`lattice:host-theme`, version 1). Lattice
// owns the shape: its `src/agent/agent-host-theme.ts` is the source of truth,
// so change this file only to follow that contract.
//
// Lattice posts the message to the agent panel on every `synara:embed-ready`,
// whenever a field changes (custom accents arrive in bursts while dragged), and
// in answer to `lattice:request-host-theme`. Light/dark still arrives through
// the frame URL's `theme`; this message never reloads the frame.

export const LATTICE_HOST_THEME = "lattice:host-theme";
export const LATTICE_REQUEST_HOST_THEME = "lattice:request-host-theme";

/**
 * Browser-computed CSS colors, ready to assign as-is: `rgb(…)`, `rgba(…)`, or
 * `color(srgb r g b / a)`. Never parse them.
 */
export interface LatticeHostPalette {
  /** Agent panel surface (embed surface=chrome); always opaque. */
  chrome: string;
  /** Drawers and the Settings dialog (embed surface=drawer). */
  drawer: string;
  /** Menus, popovers, composer, code blocks, user message bubble. */
  elevated: string;
  foreground: string;
  muted: string;
  faint: string;
  border: string;
  strongBorder: string;
  /** Interaction accent, already fitted to read as text on every surface. */
  accent: string;
  accentSoft: string;
  /** Text and icons on an accent fill. */
  accentContrast: string;
  focusRing: string;
  controlHover: string;
}

export interface LatticeHostTheme {
  type: typeof LATTICE_HOST_THEME;
  version: 1;
  /** Always equals the frame URL's `theme`. */
  theme: "light" | "dark";
  tint: "graphite" | "paper" | "sage" | "mist" | "dusk";
  /** The writer's pick, for display only; paint `colors.accent`. A custom pick is `#rrggbb`. */
  accent: "graphite" | "blue" | "purple" | "pink" | "orange" | "green" | "teal" | `#${string}`;
  /** Informational: the panel stays opaque whatever these say. */
  translucency: "off" | "subtle" | "strong";
  translucent: boolean;
  colors: LatticeHostPalette;
}

const TINTS = new Set(["graphite", "paper", "sage", "mist", "dusk"]);
const NAMED_ACCENTS = new Set(["graphite", "blue", "purple", "pink", "orange", "green", "teal"]);
const TRANSLUCENCY = new Set(["off", "subtle", "strong"]);
const PALETTE_KEYS = [
  "chrome",
  "drawer",
  "elevated",
  "foreground",
  "muted",
  "faint",
  "border",
  "strongBorder",
  "accent",
  "accentSoft",
  "accentContrast",
  "focusRing",
  "controlHover",
] as const satisfies readonly (keyof LatticeHostPalette)[];

/**
 * The contract's message, or null when it should be ignored: another version,
 * or a `theme` other than the frame's own (a stale message racing a light/dark
 * reload). Color values must be non-empty strings; they are applied verbatim.
 */
export function parseLatticeHostTheme(
  value: unknown,
  frameTheme: "light" | "dark",
): LatticeHostTheme | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.type !== LATTICE_HOST_THEME || message.version !== 1) return null;
  if (message.theme !== frameTheme) return null;
  if (typeof message.tint !== "string" || !TINTS.has(message.tint)) return null;
  if (
    typeof message.accent !== "string" ||
    !(NAMED_ACCENTS.has(message.accent) || /^#[0-9a-f]{6}$/.test(message.accent))
  ) {
    return null;
  }
  if (typeof message.translucency !== "string" || !TRANSLUCENCY.has(message.translucency)) {
    return null;
  }
  if (typeof message.translucent !== "boolean") return null;
  const colors = message.colors;
  if (!colors || typeof colors !== "object" || Array.isArray(colors)) return null;
  const palette = {} as LatticeHostPalette;
  for (const key of PALETTE_KEYS) {
    const color = (colors as Record<string, unknown>)[key];
    if (typeof color !== "string" || !color.trim()) return null;
    palette[key] = color;
  }
  return {
    type: LATTICE_HOST_THEME,
    version: 1,
    theme: frameTheme,
    tint: message.tint as LatticeHostTheme["tint"],
    accent: message.accent as LatticeHostTheme["accent"],
    translucency: message.translucency as LatticeHostTheme["translucency"],
    translucent: message.translucent,
    colors: palette,
  };
}

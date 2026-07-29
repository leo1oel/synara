import type { RuntimeMode } from "@synara/contracts";

const EMBED_MODE_STORAGE_KEY = "synara.poc.embed-mode";
const EMBED_AUTH_TOKEN_STORAGE_KEY = "synara.poc.embed-auth-token";
export const EMBED_UI_FONT_STACK =
  '"Inter Variable", Inter, "Avenir Next", "Segoe UI", sans-serif';

export const LATTICE_AGENT_PERMISSION_MODE_REQUEST =
  "lattice:request-agent-permission-mode";
export const LATTICE_AGENT_PERMISSION_MODE_SET = "lattice:set-agent-permission-mode";
export const LATTICE_SETTINGS_SECTION_SET = "lattice:set-settings-section";
export const LATTICE_PROJECT_HISTORY = "lattice:project-history";
export const LATTICE_RESTORE_AGENT_CHECKPOINT = "lattice:restore-agent-checkpoint";
export const SYNARA_AGENT_PERMISSION_MODE_STATUS = "synara:agent-permission-mode";
export const SYNARA_LAYOUT_METRICS = "synara:layout-metrics";
export const SYNARA_SETTINGS_CONTENT_HEIGHT = "synara:settings-content-height";
export const SYNARA_SETTINGS_WHEEL = "synara:settings-wheel";
export const SYNARA_OPEN_EXTERNAL = "synara:open-external";
export const SYNARA_EMBED_READY = "synara:embed-ready";

export interface EmbedModeConfig {
  workspaceRoot: string;
  theme: "light" | "dark";
  hostOrigin: string | null;
}

export type LatticeAgentPermissionModeMessage =
  | { type: typeof LATTICE_AGENT_PERMISSION_MODE_REQUEST }
  | { type: typeof LATTICE_AGENT_PERMISSION_MODE_SET; mode: RuntimeMode };

export interface LatticeSettingsSectionMessage {
  type: typeof LATTICE_SETTINGS_SECTION_SET;
  section: string;
}

export interface LatticeProjectHistoryCheckpoint {
  id: string;
  label: string;
  timestamp: string;
  threadId: string;
  threadTitle: string;
  turnId: string;
  turnCount: number;
  checkpointRef: string;
  files: ReadonlyArray<{
    path: string;
    kind: string;
    additions: number;
    deletions: number;
  }>;
}

export interface LatticeCheckpointRestoreMessage {
  type: typeof LATTICE_RESTORE_AGENT_CHECKPOINT;
  threadId: string;
  turnCount: number;
}

function normalizedOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isRuntimeMode(value: unknown): value is RuntimeMode {
  return value === "approval-required" || value === "auto" || value === "full-access";
}

export function readLatticeAgentPermissionModeMessage(
  event: MessageEvent,
  config: EmbedModeConfig,
): LatticeAgentPermissionModeMessage | null {
  if (
    !config.hostOrigin ||
    event.source !== window.parent ||
    event.origin !== config.hostOrigin ||
    !event.data ||
    typeof event.data !== "object"
  ) {
    return null;
  }
  if (event.data.type === LATTICE_AGENT_PERMISSION_MODE_REQUEST) {
    return { type: LATTICE_AGENT_PERMISSION_MODE_REQUEST };
  }
  if (
    event.data.type === LATTICE_AGENT_PERMISSION_MODE_SET &&
    isRuntimeMode(event.data.mode)
  ) {
    return { type: LATTICE_AGENT_PERMISSION_MODE_SET, mode: event.data.mode };
  }
  return null;
}

export function postAgentPermissionModeToLattice(
  config: EmbedModeConfig,
  mode: RuntimeMode,
  autoModeAvailable: boolean,
): void {
  if (!config.hostOrigin) return;
  window.parent.postMessage(
    {
      type: SYNARA_AGENT_PERMISSION_MODE_STATUS,
      mode,
      autoModeAvailable,
    },
    config.hostOrigin,
  );
}

export function postProjectHistoryToLattice(
  config: EmbedModeConfig,
  activeThreadId: string,
  entries: ReadonlyArray<LatticeProjectHistoryCheckpoint>,
): void {
  if (!config.hostOrigin) return;
  window.parent.postMessage(
    {
      type: LATTICE_PROJECT_HISTORY,
      activeThreadId,
      entries,
    },
    config.hostOrigin,
  );
}

export function readLatticeCheckpointRestoreMessage(
  event: MessageEvent,
  config: EmbedModeConfig,
): LatticeCheckpointRestoreMessage | null {
  if (
    !config.hostOrigin ||
    event.source !== window.parent ||
    event.origin !== config.hostOrigin ||
    event.data?.type !== LATTICE_RESTORE_AGENT_CHECKPOINT ||
    typeof event.data.threadId !== "string" ||
    !Number.isInteger(event.data.turnCount) ||
    event.data.turnCount < 0
  ) {
    return null;
  }
  return {
    type: LATTICE_RESTORE_AGENT_CHECKPOINT,
    threadId: event.data.threadId,
    turnCount: event.data.turnCount,
  };
}

export function postLayoutMetricsToLattice(
  config: EmbedModeConfig,
  minimumSidebarWidth: number,
): void {
  if (!config.hostOrigin || !Number.isFinite(minimumSidebarWidth)) return;
  window.parent.postMessage(
    {
      type: SYNARA_LAYOUT_METRICS,
      minimumSidebarWidth: Math.round(minimumSidebarWidth),
    },
    config.hostOrigin,
  );
}

export function readLatticeSettingsSectionMessage(
  event: MessageEvent,
  config: EmbedModeConfig,
): LatticeSettingsSectionMessage | null {
  if (
    !config.hostOrigin ||
    event.source !== window.parent ||
    event.origin !== config.hostOrigin ||
    event.data?.type !== LATTICE_SETTINGS_SECTION_SET ||
    typeof event.data.section !== "string"
  ) {
    return null;
  }
  return { type: LATTICE_SETTINGS_SECTION_SET, section: event.data.section };
}

export function postSettingsContentHeightToLattice(
  config: EmbedModeConfig,
  height: number,
): void {
  if (!config.hostOrigin || !Number.isFinite(height)) return;
  window.parent.postMessage(
    {
      type: SYNARA_SETTINGS_CONTENT_HEIGHT,
      height: Math.ceil(height),
    },
    config.hostOrigin,
  );
}

export function postSettingsWheelToLattice(
  config: EmbedModeConfig,
  event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode">,
): void {
  if (!config.hostOrigin) return;
  window.parent.postMessage(
    {
      type: SYNARA_SETTINGS_WHEEL,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
    },
    config.hostOrigin,
  );
}

export function postExternalLinkToLattice(config: EmbedModeConfig, url: string): boolean {
  if (!config.hostOrigin || !/^https?:\/\//i.test(url)) return false;
  window.parent.postMessage({ type: SYNARA_OPEN_EXTERNAL, url }, config.hostOrigin);
  return true;
}

export function postEmbedReadyToLattice(config: EmbedModeConfig): void {
  if (!config.hostOrigin) return;
  window.parent.postMessage({ type: SYNARA_EMBED_READY }, config.hostOrigin);
}

function readFragmentAuthToken(): string | null {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get("lattice-auth")?.trim() ?? "";
  if (!token) return null;
  fragment.delete("lattice-auth");
  const cleanFragment = fragment.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}${cleanFragment ? `#${cleanFragment}` : ""}`,
  );
  return token;
}

export function readEmbeddedHostWsUrl(): string | null {
  if (typeof window === "undefined" || !readEmbedMode()) return null;
  const token = sessionStorage.getItem(EMBED_AUTH_TOKEN_STORAGE_KEY)?.trim();
  if (!token) return null;
  const url = new URL(window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/";
  url.searchParams.set("token", token);
  return url.toString();
}

export function applyEmbedTheme(config: EmbedModeConfig): void {
  const root = document.documentElement;
  root.dataset.synaraEmbed = "true";
  root.classList.toggle("dark", config.theme === "dark");
  const colors = config.theme === "dark"
    ? {
        background: "#141416",
        surface: "#141416",
        elevated: "#202023",
        settingsField: "#171718",
        settingsPanel: "#202023",
        settingsSoftPanel: "#1b1b1d",
        foreground: "#e9e9e7",
        muted: "#a4a4aa",
        faint: "#88888f",
        border: "rgba(255, 255, 255, 0.075)",
        strongBorder: "rgba(255, 255, 255, 0.12)",
        accent: "#e7e7e4",
        accentSoft: "rgba(255, 255, 255, 0.1)",
      }
    : {
        background: "#efeff0",
        surface: "#efeff0",
        elevated: "#ffffff",
        settingsField: "#f7f7f6",
        settingsPanel: "#ffffff",
        settingsSoftPanel: "#fbfbfa",
        foreground: "#242426",
        muted: "#606066",
        faint: "#6c6c72",
        border: "rgba(28, 28, 31, 0.09)",
        strongBorder: "rgba(28, 28, 31, 0.14)",
        accent: "#303033",
        accentSoft: "rgba(48, 48, 51, 0.08)",
      };
  const variables: Record<string, string> = {
    "--app-shell-background": colors.background,
    "--color-background-panel": colors.surface,
    "--color-background-surface": colors.surface,
    "--color-background-surface-under": colors.background,
    "--color-token-main-surface-primary": colors.surface,
    "--background": colors.background,
    "--foreground": colors.foreground,
    "--card": colors.surface,
    "--card-foreground": colors.foreground,
    "--popover": colors.elevated,
    "--popover-foreground": colors.foreground,
    "--muted-foreground": colors.muted,
    "--border": colors.border,
    "--input": colors.border,
    "--sidebar": colors.background,
    "--sidebar-foreground": colors.foreground,
    "--lattice-settings-field": colors.settingsField,
    "--lattice-settings-panel": colors.settingsPanel,
    "--lattice-settings-soft-panel": colors.settingsSoftPanel,
    "--lattice-settings-text": colors.foreground,
    "--lattice-settings-muted": colors.muted,
    "--lattice-settings-faint": colors.faint,
    "--lattice-settings-line": colors.border,
    "--lattice-settings-line-strong": colors.strongBorder,
    "--lattice-settings-accent": colors.accent,
    "--lattice-settings-accent-soft": colors.accentSoft,
    "--theme-font-ui-family": EMBED_UI_FONT_STACK,
    ...(config.theme === "light" ? { "--composer-surface": "#f9f9fa" } : {}),
  };
  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
}

export function initializeEmbedMode(): void {
  const search = new URLSearchParams(window.location.search);
  const workspaceRoot = search.get("workspaceRoot")?.trim() ?? "";
  const embed = search.get("embed");
  const themeValue = search.get("theme");
  const theme = themeValue === "dark" || themeValue === '"dark"' ? "dark" : "light";
  if ((embed === "1" || embed === '"1"' || embed === "true") && workspaceRoot) {
    const hostOrigin =
      normalizedOrigin(search.get("hostOrigin")) || normalizedOrigin(document.referrer);
    const config: EmbedModeConfig = { workspaceRoot, theme, hostOrigin };
    const authToken = readFragmentAuthToken();
    if (authToken) {
      sessionStorage.setItem(EMBED_AUTH_TOKEN_STORAGE_KEY, authToken);
    }
    sessionStorage.setItem(EMBED_MODE_STORAGE_KEY, JSON.stringify(config));
    applyEmbedTheme(config);
  } else {
    sessionStorage.removeItem(EMBED_MODE_STORAGE_KEY);
    sessionStorage.removeItem(EMBED_AUTH_TOKEN_STORAGE_KEY);
  }
}

export function readEmbedMode(): EmbedModeConfig | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(EMBED_MODE_STORAGE_KEY) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object" || !("workspaceRoot" in parsed)) return null;
    const workspaceRoot = String(parsed.workspaceRoot).trim();
    const theme = "theme" in parsed && parsed.theme === "dark" ? "dark" : "light";
    const hostOrigin =
      "hostOrigin" in parsed && typeof parsed.hostOrigin === "string"
        ? normalizedOrigin(parsed.hostOrigin)
        : null;
    return workspaceRoot ? { workspaceRoot, theme, hostOrigin } : null;
  } catch {
    return null;
  }
}

export function isSynaraEmbedMode(): boolean {
  return readEmbedMode() !== null;
}

import type { RuntimeMode } from "@synara/contracts";
import { workspaceRootsEqual } from "@synara/shared/threadWorkspace";

const EMBED_MODE_STORAGE_KEY = "synara.poc.embed-mode";
const EMBED_AUTH_TOKEN_STORAGE_KEY = "synara.poc.embed-auth-token";
export const EMBED_UI_FONT_STACK = '"Inter Variable", Inter, "Avenir Next", "Segoe UI", sans-serif';

export const LATTICE_AGENT_PERMISSION_MODE_REQUEST = "lattice:request-agent-permission-mode";
export const LATTICE_AGENT_PERMISSION_MODE_SET = "lattice:set-agent-permission-mode";
export const LATTICE_AGENT_PANEL_OPENED = "lattice:agent-panel-opened";
export const LATTICE_SETTINGS_SECTION_SET = "lattice:set-settings-section";
export const LATTICE_PROJECT_HISTORY = "lattice:project-history";
export const LATTICE_RESTORE_AGENT_CHECKPOINT = "lattice:restore-agent-checkpoint";
export const LATTICE_HOST_CONTEXT = "lattice:host-context";
export const LATTICE_HOST_CONTEXT_REQUEST = "lattice:request-host-context";
export const LATTICE_HOST_CONTEXT_SELECTION_CLEAR = "lattice:clear-host-context-selection";
export const LATTICE_PAPER_LIBRARY = "lattice:paper-library";
export const LATTICE_PAPER_LIBRARY_REQUEST = "lattice:request-paper-library";
export const SYNARA_AGENT_PERMISSION_MODE_STATUS = "synara:agent-permission-mode";
export const SYNARA_LAYOUT_METRICS = "synara:layout-metrics";
export const SYNARA_SETTINGS_CONTENT_HEIGHT = "synara:settings-content-height";
export const SYNARA_SETTINGS_WHEEL = "synara:settings-wheel";
export const SYNARA_OPEN_EXTERNAL = "synara:open-external";
export const SYNARA_SHOW_IN_FOLDER = "synara:show-in-folder";
export const SYNARA_EMBED_READY = "synara:embed-ready";
export const SYNARA_CONFIRMATION_REQUEST = "synara:confirmation-request";
export const LATTICE_CONFIRMATION_ACK = "lattice:confirmation-ack";
export const LATTICE_CONFIRMATION_RESPONSE = "lattice:confirmation-response";

export interface EmbedModeConfig {
  workspaceRoot: string;
  theme: "light" | "dark";
  surface: "chrome" | "drawer";
  hostOrigin: string | null;
}

export interface SynaraConfirmationRequest {
  type: typeof SYNARA_CONFIRMATION_REQUEST;
  id: string;
  message: string;
}

export type LatticeConfirmationMessage =
  | {
      type: typeof LATTICE_CONFIRMATION_ACK;
      id: string;
    }
  | {
      type: typeof LATTICE_CONFIRMATION_RESPONSE;
      id: string;
      confirmed: boolean;
    };

export type LatticeHostSurface = "editor" | "pdf" | "paper";

export interface LatticeHostContextSnapshot {
  type: typeof LATTICE_HOST_CONTEXT;
  version: 1;
  workspaceRoot: string;
  activeSurface: LatticeHostSurface;
  editor?: {
    path: string;
    line: number;
    column: number;
    secondaryPath?: string;
    selection?: string;
  };
  pdf?: {
    page: number;
    pageCount: number | null;
    selection?: string;
  };
  paper?: {
    title: string;
    arxivId: string;
    citationKey?: string;
    path: string;
    view: "blog" | "fulltext";
    selection?: string;
  };
}

export interface LatticePaperLibraryEntry {
  title: string;
  arxivId: string;
  citationKey?: string;
  path: string;
  view: "blog" | "fulltext";
}

export interface LatticePaperLibrarySnapshot {
  type: typeof LATTICE_PAPER_LIBRARY;
  version: 1;
  workspaceRoot: string;
  papers: LatticePaperLibraryEntry[];
}

export function embedWorkspaceMatches(config: EmbedModeConfig, projectCwd: unknown): boolean {
  return (
    typeof projectCwd === "string" &&
    projectCwd.trim().length > 0 &&
    workspaceRootsEqual(projectCwd, config.workspaceRoot)
  );
}

export type LatticeAgentPermissionModeMessage =
  | { type: typeof LATTICE_AGENT_PERMISSION_MODE_REQUEST }
  | { type: typeof LATTICE_AGENT_PERMISSION_MODE_SET; mode: RuntimeMode };

export interface LatticeSettingsSectionMessage {
  type: typeof LATTICE_SETTINGS_SECTION_SET;
  section: string;
}

export function readLatticeAgentPanelOpenedMessage(event: MessageEvent, config: EmbedModeConfig): boolean {
  return Boolean(
    config.hostOrigin &&
    event.source === window.parent &&
    event.origin === config.hostOrigin &&
    event.data &&
    typeof event.data === "object" &&
    event.data.type === LATTICE_AGENT_PANEL_OPENED,
  );
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

interface LatticeProjectHistoryMessageSource {
  role: string;
  turnId?: string | null;
  text: string;
}

interface LatticeProjectHistorySummarySource {
  turnId: string;
  completedAt: string;
  status?: string | undefined;
  checkpointRef?: string | undefined;
  checkpointTurnCount?: number | undefined;
  files?:
    | ReadonlyArray<{
        path: string;
        kind?: string | undefined;
        additions?: number | undefined;
        deletions?: number | undefined;
      }>
    | undefined;
}

export function buildLatticeProjectHistoryCheckpoints(input: {
  threadId: string;
  threadTitle: string;
  messages: ReadonlyArray<LatticeProjectHistoryMessageSource> | null | undefined;
  summaries: ReadonlyArray<LatticeProjectHistorySummarySource> | null | undefined;
  inferredCheckpointTurnCountByTurnId: Readonly<Record<string, number | undefined>>;
}): LatticeProjectHistoryCheckpoint[] {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const summaries = input.summaries ?? [];
  const promptsByTurnId = new Map(
    messages
      .filter(
        (message) => message.role === "user" && typeof message.turnId === "string" && typeof message.text === "string",
      )
      .map((message) => [message.turnId!, message.text] as const),
  );

  return summaries.flatMap((summary) => {
    const files = summary.files ?? [];
    const turnCount = summary.checkpointTurnCount ?? input.inferredCheckpointTurnCountByTurnId[summary.turnId];
    if (
      summary.status !== "ready" ||
      files.length === 0 ||
      typeof summary.checkpointRef !== "string" ||
      typeof turnCount !== "number" ||
      !Number.isInteger(turnCount) ||
      turnCount < 0
    ) {
      return [];
    }
    const prompt = promptsByTurnId.get(summary.turnId)?.replace(/\s+/g, " ").trim();
    const compactPrompt = prompt && prompt.length > 82 ? `${prompt.slice(0, 81)}…` : prompt;
    return [
      {
        id: `agent:${input.threadId}:${summary.turnId}`,
        label: compactPrompt ? `Agent: ${compactPrompt}` : "Agent updated project files",
        timestamp: summary.completedAt,
        threadId: input.threadId,
        threadTitle: input.threadTitle,
        turnId: summary.turnId,
        turnCount,
        checkpointRef: summary.checkpointRef,
        files: files.map((file) => ({
          path: file.path,
          kind: file.kind ?? "modified",
          additions: file.additions ?? 0,
          deletions: file.deletions ?? 0,
        })),
      },
    ];
  });
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

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function nonEmptyBoundedString(value: unknown, maximum: number): value is string {
  return boundedString(value, maximum) && value.trim().length > 0;
}

function isSafePaperId(value: string): boolean {
  return (
    !value.includes("\\") &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

export function readLatticeHostContextMessage(
  event: MessageEvent,
  config: EmbedModeConfig,
): LatticeHostContextSnapshot | null {
  if (
    !config.hostOrigin ||
    event.source !== window.parent ||
    event.origin !== config.hostOrigin ||
    !event.data ||
    typeof event.data !== "object"
  ) {
    return null;
  }
  const value = event.data as Record<string, unknown>;
  if (
    value.type !== LATTICE_HOST_CONTEXT ||
    value.version !== 1 ||
    !boundedString(value.workspaceRoot, 4_096) ||
    !workspaceRootsEqual(value.workspaceRoot, config.workspaceRoot) ||
    (value.activeSurface !== "editor" && value.activeSurface !== "pdf" && value.activeSurface !== "paper")
  ) {
    return null;
  }

  const editor = value.editor;
  if (editor !== undefined) {
    if (!editor || typeof editor !== "object") return null;
    const candidate = editor as Record<string, unknown>;
    if (
      !boundedString(candidate.path, 4_096) ||
      !positiveInteger(candidate.line) ||
      !nonNegativeInteger(candidate.column) ||
      (candidate.secondaryPath !== undefined && !boundedString(candidate.secondaryPath, 4_096)) ||
      (candidate.selection !== undefined && !boundedString(candidate.selection, 12_001))
    ) {
      return null;
    }
  }

  const pdf = value.pdf;
  if (pdf !== undefined) {
    if (!pdf || typeof pdf !== "object") return null;
    const candidate = pdf as Record<string, unknown>;
    if (
      !positiveInteger(candidate.page) ||
      (candidate.pageCount !== null && !positiveInteger(candidate.pageCount)) ||
      (candidate.selection !== undefined && !boundedString(candidate.selection, 12_001))
    ) {
      return null;
    }
  }

  const paper = value.paper;
  if (paper !== undefined) {
    if (!paper || typeof paper !== "object") return null;
    const candidate = paper as Record<string, unknown>;
    if (
      !boundedString(candidate.title, 1_000) ||
      !boundedString(candidate.arxivId, 128) ||
      !boundedString(candidate.path, 4_096) ||
      (candidate.citationKey !== undefined && !boundedString(candidate.citationKey, 512)) ||
      (candidate.view !== "blog" && candidate.view !== "fulltext") ||
      (candidate.selection !== undefined && !boundedString(candidate.selection, 12_001))
    ) {
      return null;
    }
  }

  if (
    (value.activeSurface === "paper" && paper === undefined) ||
    (value.activeSurface === "pdf" && pdf === undefined)
  ) {
    return null;
  }
  return value as unknown as LatticeHostContextSnapshot;
}

export function readLatticePaperLibraryMessage(
  event: MessageEvent,
  config: EmbedModeConfig,
): LatticePaperLibrarySnapshot | null {
  if (
    !config.hostOrigin ||
    event.source !== window.parent ||
    event.origin !== config.hostOrigin ||
    !event.data ||
    typeof event.data !== "object"
  ) {
    return null;
  }
  const value = event.data as Record<string, unknown>;
  if (
    value.type !== LATTICE_PAPER_LIBRARY ||
    value.version !== 1 ||
    !boundedString(value.workspaceRoot, 4_096) ||
    !workspaceRootsEqual(value.workspaceRoot, config.workspaceRoot) ||
    !Array.isArray(value.papers) ||
    value.papers.length > 2_000
  ) {
    return null;
  }

  for (const paper of value.papers) {
    if (!paper || typeof paper !== "object") return null;
    const candidate = paper as Record<string, unknown>;
    if (
      !nonEmptyBoundedString(candidate.title, 1_000) ||
      !nonEmptyBoundedString(candidate.arxivId, 128) ||
      !isSafePaperId(candidate.arxivId) ||
      !boundedString(candidate.path, 4_096) ||
      (candidate.citationKey !== undefined && !nonEmptyBoundedString(candidate.citationKey, 512)) ||
      (candidate.view !== "blog" && candidate.view !== "fulltext")
    ) {
      return null;
    }
    const expectedPath = `.research/papers/${candidate.arxivId}/${
      candidate.view === "fulltext" ? "paper.md" : "blog.md"
    }`;
    if (candidate.path !== expectedPath) return null;
  }

  return value as unknown as LatticePaperLibrarySnapshot;
}

export function postHostContextRequestToLattice(config: EmbedModeConfig): void {
  if (!config.hostOrigin) return;
  window.parent.postMessage({ type: LATTICE_HOST_CONTEXT_REQUEST }, config.hostOrigin);
}

export function postPaperLibraryRequestToLattice(config: EmbedModeConfig): void {
  if (!config.hostOrigin) return;
  window.parent.postMessage({ type: LATTICE_PAPER_LIBRARY_REQUEST }, config.hostOrigin);
}

export function postHostContextSelectionClearToLattice(config: EmbedModeConfig): void {
  if (!config.hostOrigin) return;
  window.parent.postMessage({ type: LATTICE_HOST_CONTEXT_SELECTION_CLEAR }, config.hostOrigin);
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
  if (event.data.type === LATTICE_AGENT_PERMISSION_MODE_SET && isRuntimeMode(event.data.mode)) {
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

export function postLayoutMetricsToLattice(config: EmbedModeConfig, minimumSidebarWidth: number): void {
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

export function postSettingsContentHeightToLattice(config: EmbedModeConfig, height: number, section: string): void {
  if (!config.hostOrigin || !Number.isFinite(height) || !section) return;
  window.parent.postMessage(
    {
      type: SYNARA_SETTINGS_CONTENT_HEIGHT,
      height: Math.ceil(height),
      section,
    },
    config.hostOrigin,
  );
}

export function postSettingsWheelToLattice(
  config: EmbedModeConfig,
  event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode">,
  content?: {
    height: number;
    section: string;
  },
): void {
  if (!config.hostOrigin) return;
  const contentHeight = content && Number.isFinite(content.height) ? Math.ceil(content.height) : undefined;
  const section = content?.section.trim() || undefined;
  window.parent.postMessage(
    {
      type: SYNARA_SETTINGS_WHEEL,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      ...(contentHeight !== undefined && section ? { contentHeight, section } : {}),
    },
    config.hostOrigin,
  );
}

export function postExternalLinkToLattice(config: EmbedModeConfig, url: string): boolean {
  if (!config.hostOrigin || !/^https?:\/\//i.test(url)) return false;
  window.parent.postMessage({ type: SYNARA_OPEN_EXTERNAL, url }, config.hostOrigin);
  return true;
}

export function postShowInFolderToLattice(config: EmbedModeConfig, path: string): boolean {
  if (!config.hostOrigin || !path.trim()) return false;
  window.parent.postMessage({ type: SYNARA_SHOW_IN_FOLDER, path }, config.hostOrigin);
  return true;
}

export function postEmbedReadyToLattice(config: EmbedModeConfig): void {
  if (!config.hostOrigin) return;
  window.parent.postMessage({ type: SYNARA_EMBED_READY }, config.hostOrigin);
}

export function postConfirmationRequestToLattice(
  config: EmbedModeConfig,
  request: Omit<SynaraConfirmationRequest, "type">,
): void {
  if (!config.hostOrigin || !boundedString(request.id, 128) || !boundedString(request.message, 4_096)) {
    return;
  }
  window.parent.postMessage(
    {
      type: SYNARA_CONFIRMATION_REQUEST,
      id: request.id,
      message: request.message,
    } satisfies SynaraConfirmationRequest,
    config.hostOrigin,
  );
}

export function readLatticeConfirmationMessage(
  event: MessageEvent,
  config: EmbedModeConfig,
  requestId: string,
): LatticeConfirmationMessage | null {
  if (
    !config.hostOrigin ||
    event.source !== window.parent ||
    event.origin !== config.hostOrigin ||
    !event.data ||
    typeof event.data !== "object" ||
    event.data.id !== requestId
  ) {
    return null;
  }
  if (event.data.type === LATTICE_CONFIRMATION_ACK) {
    return { type: LATTICE_CONFIRMATION_ACK, id: requestId };
  }
  if (event.data.type === LATTICE_CONFIRMATION_RESPONSE && typeof event.data.confirmed === "boolean") {
    return {
      type: LATTICE_CONFIRMATION_RESPONSE,
      id: requestId,
      confirmed: event.data.confirmed,
    };
  }
  return null;
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
  const usesDrawerSurface = config.surface === "drawer";
  const colors =
    config.theme === "dark"
      ? {
          background: usesDrawerSurface ? "#1b1b1d" : "#141416",
          surface: usesDrawerSurface ? "#1b1b1d" : "#141416",
          elevated: "#202023",
          settingsField: "#1b1b1d",
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
          background: usesDrawerSurface ? "#f9f9fa" : "#efeff0",
          surface: usesDrawerSurface ? "#f9f9fa" : "#efeff0",
          elevated: "#F9F9FA",
          settingsField: "#f9f9fa",
          settingsPanel: "#F9F9FA",
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
    "--lattice-settings-content-max-width": "500px",
    "--lattice-settings-content-padding-top": "30px",
    "--lattice-settings-content-padding-inline": "34px",
    "--lattice-settings-content-padding-bottom": "40px",
    "--lattice-settings-frame-border-width": "1px",
    "--lattice-settings-frame-radius": "8px",
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
  const surface = search.get("surface") === "drawer" ? "drawer" : "chrome";
  if ((embed === "1" || embed === '"1"' || embed === "true") && workspaceRoot) {
    const hostOrigin = normalizedOrigin(search.get("hostOrigin")) || normalizedOrigin(document.referrer);
    const config: EmbedModeConfig = { workspaceRoot, theme, surface, hostOrigin };
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
    const surface = "surface" in parsed && parsed.surface === "drawer" ? "drawer" : "chrome";
    const hostOrigin =
      "hostOrigin" in parsed && typeof parsed.hostOrigin === "string" ? normalizedOrigin(parsed.hostOrigin) : null;
    return workspaceRoot ? { workspaceRoot, theme, surface, hostOrigin } : null;
  } catch {
    return null;
  }
}

export function isSynaraEmbedMode(): boolean {
  return readEmbedMode() !== null;
}

import type { RuntimeMode } from "@synara/contracts";
import { isWorkspaceRelativePathSafe, workspaceRelativePathOf } from "@synara/shared/path";
import { workspaceRootsEqual } from "@synara/shared/threadWorkspace";

import { resolveMarkdownFileLinkTarget } from "./markdown-links";

const EMBED_MODE_STORAGE_KEY = "synara.poc.embed-mode";
const EMBED_AUTH_TOKEN_STORAGE_KEY = "synara.poc.embed-auth-token";
const FILE_POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;
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
export const LATTICE_COMPOSER_FILES = "lattice:composer-files";
export const LATTICE_HOST_POINTER = "lattice:host-pointer";
export const SYNARA_AGENT_PERMISSION_MODE_STATUS = "synara:agent-permission-mode";
export const SYNARA_LAYOUT_METRICS = "synara:layout-metrics";
export const SYNARA_SETTINGS_CONTENT_HEIGHT = "synara:settings-content-height";
export const SYNARA_SETTINGS_WHEEL = "synara:settings-wheel";
export const SYNARA_OPEN_SETTINGS = "synara:open-settings";
export const SYNARA_OPEN_EXTERNAL = "synara:open-external";
export const SYNARA_SHOW_IN_FOLDER = "synara:show-in-folder";
export const SYNARA_EMBED_READY = "synara:embed-ready";
export const SYNARA_OPEN_REVIEW = "synara:open-review";
export const SYNARA_OPEN_FILE = "synara:open-file";
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

export interface LatticeComposerFileEntry {
  name: string;
  mimeType: string;
  bytes: ArrayBuffer;
}

export interface LatticeComposerFilesMessage {
  type: typeof LATTICE_COMPOSER_FILES;
  version: 1;
  files: LatticeComposerFileEntry[];
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

export function readLatticeAgentPanelOpenedMessage(
  event: MessageEvent,
  config: EmbedModeConfig,
): boolean {
  return Boolean(
    config.hostOrigin &&
    event.source === window.parent &&
    event.origin === config.hostOrigin &&
    event.data &&
    typeof event.data === "object" &&
    event.data.type === LATTICE_AGENT_PANEL_OPENED,
  );
}

/**
 * True when the host reports its own document saw the pointer — i.e. the
 * cursor is not over this frame. WebKit does not deliver `pointerleave`
 * across the iframe boundary, so in-frame hover states (the overlay
 * scrollbar) treat this as the missing leave signal.
 */
export function readLatticeHostPointerMessage(
  event: MessageEvent,
  config: EmbedModeConfig,
): boolean {
  return Boolean(
    config.hostOrigin &&
    event.source === window.parent &&
    event.origin === config.hostOrigin &&
    event.data &&
    typeof event.data === "object" &&
    event.data.type === LATTICE_HOST_POINTER,
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
        (message) =>
          message.role === "user" &&
          typeof message.turnId === "string" &&
          typeof message.text === "string",
      )
      .map((message) => [message.turnId!, message.text] as const),
  );

  return summaries.flatMap((summary) => {
    const files = summary.files ?? [];
    const turnCount =
      summary.checkpointTurnCount ?? input.inferredCheckpointTurnCountByTurnId[summary.turnId];
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
    (value.activeSurface !== "editor" &&
      value.activeSurface !== "pdf" &&
      value.activeSurface !== "paper")
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

const MAX_COMPOSER_FILE_COUNT = 20;
const MAX_COMPOSER_FILE_BYTES = 64 * 1024 * 1024;

// Split chat surfaces mount one ChatView per pane, and every pane's listener
// receives the same MessageEvent. Claim each event on first successful read so
// a dropped file lands in exactly one composer.
const consumedComposerFileEvents = new WeakSet<MessageEvent>();

export function readLatticeComposerFilesMessage(
  event: MessageEvent,
  config: EmbedModeConfig,
): File[] | null {
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
    value.type !== LATTICE_COMPOSER_FILES ||
    value.version !== 1 ||
    !Array.isArray(value.files) ||
    value.files.length === 0 ||
    value.files.length > MAX_COMPOSER_FILE_COUNT
  ) {
    return null;
  }
  const files: File[] = [];
  for (const entry of value.files) {
    if (!entry || typeof entry !== "object") return null;
    const candidate = entry as Record<string, unknown>;
    if (
      !nonEmptyBoundedString(candidate.name, 1_024) ||
      candidate.name.includes("/") ||
      candidate.name.includes("\\") ||
      !boundedString(candidate.mimeType, 256) ||
      !(candidate.bytes instanceof ArrayBuffer) ||
      candidate.bytes.byteLength === 0 ||
      candidate.bytes.byteLength > MAX_COMPOSER_FILE_BYTES
    ) {
      return null;
    }
    files.push(
      new File([candidate.bytes], candidate.name, {
        type: candidate.mimeType,
      }),
    );
  }
  if (consumedComposerFileEvents.has(event)) return null;
  consumedComposerFileEvents.add(event);
  return files;
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
  section: string,
): void {
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
  const contentHeight =
    content && Number.isFinite(content.height) ? Math.ceil(content.height) : undefined;
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

// Same reason as the review hand-off: a file reference in an answer opens a
// dock pane, and the embed has no dock, so clicking one did nothing at all.
// The host owns an editor already — give it the file.
export function postOpenFileToLattice(config: EmbedModeConfig, filePath: string): boolean {
  if (!config.hostOrigin || !filePath.trim()) return false;
  window.parent.postMessage({ type: SYNARA_OPEN_FILE, filePath }, config.hostOrigin);
  return true;
}

function resolveEmbeddedWorkspaceAnchor(
  href: string,
  config: EmbedModeConfig,
): string | null {
  let candidate = href.trim();
  if (!candidate) return null;

  if (/^https?:\/\//i.test(candidate)) {
    try {
      const parsed = new URL(candidate);
      if (parsed.origin !== window.location.origin) return null;
      candidate = `${parsed.pathname}${parsed.hash}`;
    } catch {
      return null;
    }
  }

  const resolved = resolveMarkdownFileLinkTarget(candidate, config.workspaceRoot);
  if (!resolved) return null;
  const withoutPosition = resolved.trim().replace(FILE_POSITION_SUFFIX_PATTERN, "");
  return (
    workspaceRelativePathOf(withoutPosition, config.workspaceRoot) ??
    (isWorkspaceRelativePathSafe(withoutPosition) ? withoutPosition : null)
  );
}

let embeddedFileLinkFallbackDocument: Document | null = null;
let embeddedFileLinkFallbackConfig: EmbedModeConfig | null = null;

function handleEmbeddedFileLinkFallback(event: MouseEvent): void {
  const config = embeddedFileLinkFallbackConfig;
  if (
    !config ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  const target = event.target as { closest?: (selector: string) => Element | null } | null;
  const anchor = target?.closest?.("a[href]");
  if (!anchor) return;
  const anchorTarget = anchor.getAttribute("target")?.trim().toLowerCase();
  if ((anchorTarget && anchorTarget !== "_self") || anchor.hasAttribute("download")) return;
  const href = anchor.getAttribute("href");
  const filePath = href ? resolveEmbeddedWorkspaceAnchor(href, config) : null;
  if (!filePath || !postOpenFileToLattice(config, filePath)) return;
  event.preventDefault();
  event.stopPropagation();
}

// Markdown file chips handle their own activation, but historical content can
// contain link shapes that render as plain anchors. In an embed, allowing one
// of those to navigate this frame replaces the entire chat app with a same-
// origin `/Users/...` request, dropping the embed theme and breaking every
// subsequent conversation. Catch only otherwise-unhandled workspace links at
// the document boundary and delegate them to the Lattice editor.
function installEmbeddedFileLinkFallback(config: EmbedModeConfig): void {
  embeddedFileLinkFallbackConfig = config;
  if (embeddedFileLinkFallbackDocument === document) return;
  embeddedFileLinkFallbackDocument?.removeEventListener(
    "click",
    handleEmbeddedFileLinkFallback,
  );
  embeddedFileLinkFallbackDocument = document;
  document.addEventListener("click", handleEmbeddedFileLinkFallback);
}

function uninstallEmbeddedFileLinkFallback(): void {
  embeddedFileLinkFallbackDocument?.removeEventListener(
    "click",
    handleEmbeddedFileLinkFallback,
  );
  embeddedFileLinkFallbackDocument = null;
  embeddedFileLinkFallbackConfig = null;
}

function canRestoreEmbedMode(config: EmbedModeConfig): boolean {
  if (window.parent === window || !config.hostOrigin) return false;
  const ancestorOrigin = window.location.ancestorOrigins?.[0];
  if (ancestorOrigin) return normalizedOrigin(ancestorOrigin) === config.hostOrigin;
  return normalizedOrigin(document.referrer) === config.hostOrigin;
}

// Embedded chats have no RightDock, so turn-diff review is delegated to the
// host: with a filePath Lattice opens that file in its editor, without one it
// opens the /review drawer pinned to this thread and turn.
export function postOpenReviewToLattice(
  config: EmbedModeConfig,
  review: { threadId: string; turnId: string; filePath?: string | undefined },
): boolean {
  if (!config.hostOrigin || !review.threadId.trim() || !review.turnId.trim()) return false;
  window.parent.postMessage(
    {
      type: SYNARA_OPEN_REVIEW,
      threadId: review.threadId,
      turnId: review.turnId,
      ...(review.filePath?.trim() ? { filePath: review.filePath } : {}),
    },
    config.hostOrigin,
  );
  return true;
}

export function postOpenSettingsToLattice(config: EmbedModeConfig, section: "providers"): boolean {
  if (!config.hostOrigin) return false;
  window.parent.postMessage({ type: SYNARA_OPEN_SETTINGS, section }, config.hostOrigin);
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
  if (
    !config.hostOrigin ||
    !boundedString(request.id, 128) ||
    !boundedString(request.message, 4_096)
  ) {
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
  if (
    event.data.type === LATTICE_CONFIRMATION_RESPONSE &&
    typeof event.data.confirmed === "boolean"
  ) {
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
    "--color-background-control": colors.elevated,
    "--color-background-control-opaque": colors.elevated,
    "--color-background-elevated-primary-opaque": colors.elevated,
    "--color-background-elevated-secondary": colors.elevated,
    "--color-token-main-surface-primary": colors.surface,
    // Synara's newer controls read the Codex primitive text tokens directly,
    // while older Tailwind utilities route through --foreground. Set both
    // branches at the iframe boundary so an embedded dark surface cannot fall
    // back to the persisted light theme's black ink.
    "--color-text-foreground": colors.foreground,
    "--color-text-foreground-secondary": colors.muted,
    "--color-text-foreground-tertiary": colors.faint,
    "--color-icon-primary": colors.foreground,
    "--color-icon-secondary": colors.muted,
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
    "--lattice-control-hover-surface":
      config.theme === "dark" ? "rgba(255, 255, 255, 0.07)" : "rgba(36, 36, 38, 0.07)",
    "--lattice-floating-surface-shadow":
      config.theme === "dark"
        ? "0 1px 2px rgba(0, 0, 0, 0.18), 0 16px 36px -18px rgba(0, 0, 0, 0.8)"
        : "0 1px 2px rgba(28, 25, 23, 0.06), 0 16px 36px -18px rgba(28, 25, 23, 0.5)",
    "--lattice-settings-content-max-width": "720px",
    "--lattice-settings-content-padding-top": "32px",
    "--lattice-settings-content-padding-inline": "40px",
    "--lattice-settings-content-padding-bottom": "48px",
    "--lattice-settings-control-width": "170px",
    "--lattice-settings-control-height": "30px",
    "--lattice-settings-control-radius": "9px",
    "--lattice-settings-control-font-size": "12px",
    "--lattice-settings-control-line-height": "16px",
    "--lattice-settings-control-font-weight": "400",
    "--lattice-settings-frame-border-width": "1px",
    "--lattice-settings-frame-radius": "8px",
    "--theme-font-ui-family": EMBED_UI_FONT_STACK,
    // The composer lives inside this iframe. Set its surface at the embed
    // boundary so a dark Lattice host cannot leave it on the web app's light
    // default while the rest of the chrome has already switched themes.
    "--composer-surface": config.theme === "dark" ? colors.elevated : "#f9f9fa",
    "--lattice-agent-composer-surface": config.theme === "dark" ? colors.elevated : "#f9f9fa",
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
    const hostOrigin =
      normalizedOrigin(search.get("hostOrigin")) || normalizedOrigin(document.referrer);
    const config: EmbedModeConfig = { workspaceRoot, theme, surface, hostOrigin };
    const authToken = readFragmentAuthToken();
    if (authToken) {
      sessionStorage.setItem(EMBED_AUTH_TOKEN_STORAGE_KEY, authToken);
    }
    sessionStorage.setItem(EMBED_MODE_STORAGE_KEY, JSON.stringify(config));
    applyEmbedTheme(config);
    installEmbeddedFileLinkFallback(config);
  } else {
    // A historical route or an unhandled same-origin link can trigger a full
    // iframe navigation without carrying the original embed query. This is
    // still the same isolated iframe session, so retain its trusted config and
    // reapply the host theme instead of falling back to standalone Synara and
    // making every subsequently opened conversation white and asset-broken.
    const restoredConfig = readEmbedMode();
    if (restoredConfig && canRestoreEmbedMode(restoredConfig)) {
      applyEmbedTheme(restoredConfig);
      installEmbeddedFileLinkFallback(restoredConfig);
    } else {
      uninstallEmbeddedFileLinkFallback();
      sessionStorage.removeItem(EMBED_MODE_STORAGE_KEY);
      sessionStorage.removeItem(EMBED_AUTH_TOKEN_STORAGE_KEY);
    }
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
      "hostOrigin" in parsed && typeof parsed.hostOrigin === "string"
        ? normalizedOrigin(parsed.hostOrigin)
        : null;
    return workspaceRoot ? { workspaceRoot, theme, surface, hostOrigin } : null;
  } catch {
    return null;
  }
}

export function isSynaraEmbedMode(): boolean {
  return readEmbedMode() !== null;
}

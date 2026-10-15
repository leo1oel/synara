// FILE: InlineVisualFrame.tsx
// Purpose: One agent-published inline visual in the transcript: fetches its document, runs it
//          in a nested sandboxed srcdoc frame, and bridges size, theme, and scroll intent.
// Layer: Chat transcript row content
// Exports: InlineVisualFrame

import {
  INLINE_VISUAL_MAX_HEIGHT,
  INLINE_VISUAL_MIN_HEIGHT,
  type InlineVisualActivityPayload,
  type ThreadId,
} from "@synara/contracts";
import {
  buildInlineVisualHostDocument,
  clampInlineVisualHeight,
  inlineVisualThemeMessage,
  readInlineVisualFrameMessage,
  type InlineVisualTheme,
} from "@synara/shared/inlineVisual";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { isElectron } from "~/env";
import {
  isSynaraEmbedMode,
  postExpandVisualToLattice,
  postSaveVisualToLattice,
  readEmbedMode,
} from "~/embedMode";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { i18n } from "~/i18n";
import { useInlineVisualTheme } from "~/hooks/useInlineVisualTheme";
import { downloadBlob } from "~/lib/browserDownload";
import { DISCLOSURE_FADE_MOTION_CLASS } from "~/lib/disclosureMotion";
import { CheckIcon, CopyIcon, DownloadIcon, Maximize2, RotateCcwIcon } from "~/lib/icons";
import { inlineVisualQueryOptions } from "~/lib/providerReactQuery";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { IconButton } from "../ui/icon-button";

/** How tall the expanded view lets a page grow before it scrolls the dialog. */
const EXPANDED_MAX_HEIGHT = 20_000;

/**
 * An inline visual. The box holds the agent's expected height while the
 * document loads, then fits the height the page reports, so the transcript
 * grows once rather than jumping. Growth only re-measures the list row; it is
 * never a follow signal. A reader who scrolls over the frame still detaches
 * follow through `onScrollIntent`, since those gestures never reach the host.
 */
export function InlineVisualFrame(props: {
  readonly threadId: ThreadId;
  readonly visual: InlineVisualActivityPayload;
  readonly onScrollIntent?: ((upward: boolean) => void) | undefined;
}) {
  // A page that navigates its own frame is stopped before the request by the
  // host document's frame-src (see buildInlineVisualHostDocument), which every
  // engine enforces; desktop adds its native subframe guard on top. The
  // Lattice embed relies on the former. A standalone browser tab keeps
  // upstream's notice.
  return isElectron || isSynaraEmbedMode() ? (
    <SandboxedInlineVisualFrame {...props} />
  ) : (
    <InlineVisualNotice
      title={props.visual.title}
      message={i18n._(
        "HTML visuals are available in Synara desktop. Use native components in the browser.",
      )}
    />
  );
}

function SandboxedInlineVisualFrame({
  threadId,
  visual,
  onScrollIntent,
}: {
  readonly threadId: ThreadId;
  readonly visual: InlineVisualActivityPayload;
  readonly onScrollIntent?: ((upward: boolean) => void) | undefined;
}) {
  const theme = useInlineVisualTheme();
  const visualDocument = useQuery(
    inlineVisualQueryOptions({ threadId, visualId: visual.visualId }),
  );
  // Reload mounts a fresh frame (and clears a stopped one) without refetching.
  const [generation, setGeneration] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const reload = () => {
    setStopped(false);
    setGeneration((value) => value + 1);
  };
  const stop = () => {
    setExpanded(false);
    setStopped(true);
  };
  const html = visualDocument.data;

  // No caption row: the page is part of the reply and lines up with its text.
  // The title names the figure and frame for assistive technology instead.
  return (
    <figure className="group/inline-visual relative m-0 min-w-0" aria-label={visual.title}>
      {html !== undefined && !stopped ? (
        <>
          <InlineVisualDocument
            key={`${visual.visualId}:${generation}`}
            html={html}
            title={visual.title}
            reservedHeight={visual.height}
            maxHeight={INLINE_VISUAL_MAX_HEIGHT}
            theme={theme}
            onStopped={stop}
            onScrollIntent={onScrollIntent}
          />
          <div
            className={cn(
              DISCLOSURE_FADE_MOTION_CLASS,
              "absolute end-1 top-1 flex items-center gap-0.5 rounded-md border border-border/60 bg-popover/90 p-0.5 opacity-0 shadow-xs backdrop-blur-sm focus-within:opacity-100 group-hover/inline-visual:opacity-100 pointer-coarse:opacity-100",
            )}
          >
            <InlineVisualSourceActions title={visual.title} html={html} />
            <IconButton
              label={i18n._("Expand visual")}
              tooltip={i18n._("Expand")}
              onClick={() => {
                const config = readEmbedMode();
                const hostDocument = buildInlineVisualHostDocument(html, theme);
                if (
                  config &&
                  postExpandVisualToLattice(config, {
                    title: visual.title,
                    html,
                    document: hostDocument,
                  })
                ) {
                  return;
                }
                setExpanded(true);
              }}
            >
              <Maximize2 className="size-3.5" />
            </IconButton>
            <IconButton label={i18n._("Reload visual")} tooltip={i18n._("Reload")} onClick={reload}>
              <RotateCcwIcon className="size-3.5" />
            </IconButton>
          </div>
          {/* Lattice shows the expanded visual over its own window instead. */}
          <Dialog open={expanded} onOpenChange={setExpanded}>
            <DialogPopup
              bottomStickOnMobile={false}
              className="h-[calc(100dvh-2rem)] max-w-[min(64rem,100%)]"
              aria-label={visual.title}
            >
              <DialogHeader className="flex-row items-center gap-2 pe-12">
                <DialogTitle className="min-w-0 flex-1 truncate text-base">
                  {visual.title}
                </DialogTitle>
                <div className="flex shrink-0 items-center gap-0.5">
                  <InlineVisualSourceActions title={visual.title} html={html} />
                </div>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                {/* Its own page, so it starts fresh rather than mirroring the inline one. */}
                <InlineVisualDocument
                  key={`${visual.visualId}:${generation}:expanded`}
                  html={html}
                  title={visual.title}
                  reservedHeight={visual.height}
                  maxHeight={EXPANDED_MAX_HEIGHT}
                  theme={theme}
                  onStopped={stop}
                  onEscape={() => setExpanded(false)}
                />
              </div>
            </DialogPopup>
          </Dialog>
        </>
      ) : stopped ? (
        <InlineVisualNotice
          title={visual.title}
          message={i18n._("This visual stopped because it could not stay isolated.")}
          action={i18n._("Reload")}
          onAction={reload}
        />
      ) : visualDocument.isError ? (
        <InlineVisualNotice
          title={visual.title}
          message={i18n._("Visual unavailable.")}
          {...(isRetryable(visualDocument.error)
            ? { action: i18n._("Retry"), onAction: () => void visualDocument.refetch() }
            : {})}
        />
      ) : (
        <div
          className="flex items-center justify-center rounded-lg bg-muted/40 text-muted-foreground text-ui-xs"
          style={{ height: clampInlineVisualHeight(visual.height) }}
          role="status"
        >
          {i18n._("Loading visual…")}
        </div>
      )}
    </figure>
  );
}

/** Copy the agent's HTML, or save it as a file (through Lattice when embedded). */
function InlineVisualSourceActions({
  title,
  html,
}: {
  readonly title: string;
  readonly html: string;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const download = () => {
    const filename = inlineVisualFilename(title);
    const config = readEmbedMode();
    if (config && postSaveVisualToLattice(config, { filename, html })) return;
    downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), filename);
  };
  return (
    <>
      <IconButton
        label={isCopied ? i18n._("Copied") : i18n._("Copy source")}
        tooltip={isCopied ? i18n._("Copied") : i18n._("Copy source")}
        onClick={() => copyToClipboard(html, undefined)}
      >
        {isCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </IconButton>
      <IconButton
        label={i18n._("Download HTML")}
        tooltip={i18n._("Download HTML")}
        onClick={download}
      >
        <DownloadIcon className="size-3.5" />
      </IconButton>
    </>
  );
}

/** The visual's title as a file name: path and reserved characters dropped. */
function inlineVisualFilename(title: string): string {
  const name = title
    .replace(/[\p{Cc}\\/:*?"<>|]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/^\.+/, "")
    .trim();
  return `${name || "visual"}.html`;
}

/** A reported or reserved height, within the visual minimum and this view's maximum. */
function fitHeight(height: number, maxHeight: number): number {
  return Math.min(maxHeight, Math.max(INLINE_VISUAL_MIN_HEIGHT, Math.round(height)));
}

function isRetryable(error: unknown): boolean {
  return (error as { retryable?: unknown } | null)?.retryable !== false;
}

function InlineVisualNotice(props: {
  readonly title: string;
  readonly message: string;
  readonly action?: string;
  readonly onAction?: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/60 px-3 py-2 text-muted-foreground text-ui-sm"
      role="status"
    >
      <span className="min-w-0 max-w-full truncate text-foreground">{props.title}</span>
      {/* Wraps under the title in a narrow panel rather than into a sliver. */}
      <span className="min-w-[min(12rem,100%)] flex-1">{props.message}</span>
      {props.action && props.onAction ? (
        <Button size="xs" variant="outline" onClick={props.onAction}>
          {props.action}
        </Button>
      ) : null}
    </div>
  );
}

function InlineVisualDocument({
  html,
  title,
  reservedHeight,
  maxHeight,
  theme,
  onStopped,
  onScrollIntent,
  onEscape,
}: {
  readonly html: string;
  readonly title: string;
  readonly reservedHeight: number;
  readonly maxHeight: number;
  readonly theme: InlineVisualTheme;
  readonly onStopped: () => void;
  readonly onScrollIntent?: ((upward: boolean) => void) | undefined;
  readonly onEscape?: (() => void) | undefined;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Built once per mount with the theme of that moment; later theme changes
  // arrive as messages, since a new srcdoc would reload the page and lose its
  // state. The parent keys this component by visual id and reload count.
  const [srcDoc] = useState(() => buildInlineVisualHostDocument(html, theme));
  const callbacks = useRef({ onStopped, onScrollIntent, onEscape });
  const loads = useRef(0);
  const loadedWindow = useRef<Window | null>(null);
  useLayoutEffect(() => {
    callbacks.current = { onStopped, onScrollIntent, onEscape };
  });

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage(inlineVisualThemeMessage(theme), "*");
  }, [theme]);

  // Registered in the commit that inserts the frame: a fast page can post its
  // first size before a passive effect would run.
  useLayoutEffect(() => {
    let heightTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingHeight: number | undefined;
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      // Only the frame's own window, the host document that relays the
      // visual's messages; both origins are opaque, so this is the only way to
      // tell its messages from anyone else's.
      if (frame === null || event.source === null || event.source !== frame.contentWindow) {
        return;
      }
      const message = readInlineVisualFrameMessage(event.data);
      if (message === undefined) return;
      if (message.type === "size") {
        pendingHeight = fitHeight(message.height, maxHeight);
        // Bound expensive transcript remeasurement to ten updates per second.
        if (heightTimer === undefined) {
          heightTimer = setTimeout(() => {
            heightTimer = undefined;
            setContentHeight(pendingHeight ?? null);
          }, 100);
        }
      } else if (message.type === "stopped") {
        callbacks.current.onStopped();
      } else if (message.type === "scroll-intent") {
        callbacks.current.onScrollIntent?.(message.upward);
      } else if (message.type === "escape") {
        callbacks.current.onEscape?.();
      }
      // Untrusted HTML cannot open host URLs, even during user activation.
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (heightTimer !== undefined) clearTimeout(heightTimer);
    };
  }, [maxHeight]);

  const onLoad = () => {
    // srcdoc loads exactly once per browsing context. A second load in the same
    // context means the page navigated its own frame (desktop blocks that; a
    // browser cannot), so stop showing it. A frame re-inserted into the
    // document, where the list cannot move it intact, gets a new context and
    // its own srcdoc again: that is a fresh first load, not a navigation.
    const frameWindow = frameRef.current?.contentWindow ?? null;
    if (frameWindow !== loadedWindow.current) {
      loadedWindow.current = frameWindow;
      loads.current = 0;
    }
    loads.current += 1;
    if (loads.current > 1) {
      callbacks.current.onStopped();
      return;
    }
    setLoaded(true);
    // Covers a theme change that landed while the page was parsing.
    frameRef.current?.contentWindow?.postMessage(inlineVisualThemeMessage(theme), "*");
  };
  const height = contentHeight ?? fitHeight(reservedHeight, maxHeight);
  const colorScheme = loaded ? theme.appearance : "light";
  return (
    <iframe
      ref={frameRef}
      srcDoc={srcDoc}
      title={title}
      // Never allow-same-origin: the opaque origin keeps the page away from the
      // app's storage, cookies, and DOM. No popups, modals, downloads, or top
      // navigation; forms only so submit handlers run (CSP blocks submission).
      // The visual's own frame inside carries the same flags.
      sandbox="allow-scripts allow-forms"
      referrerPolicy="no-referrer"
      onLoad={onLoad}
      className="block w-full border-0 bg-transparent"
      // A frame whose color scheme differs from its document's paints an
      // opaque canvas, so the blank document would flash until the page is in.
      style={{ height, colorScheme }}
      data-inline-visual-frame=""
    />
  );
}

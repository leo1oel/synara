// FILE: FileDiffView.tsx
// Purpose: Shared diff viewer chrome — a virtualized scroll surface plus a themed
//          per-file card — used by both the turn/repo DiffPanel and the source
//          control GitPanel so they share font/theme behavior, the Synara file
//          header, and the @pierre/diffs `unsafeCSS` theming.
// Layer: Chat/diff UI primitives
// Depends on: @pierre/diffs FileDiff/Virtualizer, diffRendering (theme + unsafeCSS), FileDiffHeader

import {
  areLanguagesAttached,
  areThemesAttached,
  getFiletypeFromFileName,
  isHighlighterLoaded,
  preloadHighlighter,
} from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import { type ReactNode, useEffect, useState } from "react";

import { buildDiffPanelUnsafeCSS, resolveDiffThemeName } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { FileDiffHeader } from "./FileDiffHeader";

// Keep diff virtualization tuning in one place so every diff surface scrolls identically.
const DIFF_VIRTUALIZER_CONFIG = {
  overscrollSize: 400,
  intersectionObserverMargin: 600,
};

// Virtualized scroll container shared by single-file (GitPanel) and multi-file
// (DiffPanel) diff lists. Callers own the inner per-file wrapper markup because
// it differs (collapse click capture, data-diff-file-path scroll anchors, etc.).
export function FileDiffSurface(props: { className?: string; children: ReactNode }) {
  return (
    <Virtualizer
      className={cn("diff-render-surface", props.className)}
      config={DIFF_VIRTUALIZER_CONFIG}
    >
      {props.children}
    </Virtualizer>
  );
}

// A single themed file diff with Synara's custom file header. Bakes in the shared
// `unsafeCSS` theming so every surface renders with the chat code font and
// themed addition/deletion backgrounds.
export function FileDiffCard(props: {
  fileDiff: FileDiffMetadata;
  theme: "light" | "dark";
  diffStyle?: "unified" | "split";
  overflow?: "scroll" | "wrap";
  collapsed?: boolean;
  /** Trailing header chrome (actions menu, collapse chevron). */
  renderHeaderTrailing?: () => ReactNode;
}) {
  const options = {
    diffStyle: props.diffStyle ?? "unified",
    lineDiffType: "none" as const,
    overflow: props.overflow ?? "scroll",
    theme: resolveDiffThemeName(props.theme),
    themeType: props.theme,
    unsafeCSS: buildDiffPanelUnsafeCSS(props.theme),
    ...(props.collapsed !== undefined ? { collapsed: props.collapsed } : {}),
  };

  return (
    <FileDiff
      fileDiff={props.fileDiff}
      options={options}
      renderCustomHeader={(fileDiff) => (
        <FileDiffHeader
          fileDiff={fileDiff}
          theme={props.theme}
          trailing={props.renderHeaderTrailing?.()}
        />
      )}
    />
  );
}

// Source Control displays one selected file at a time, so list virtualization
// only introduces stale offsets and WebKit grid gaps. Preload Pierre's exact
// highlighter resources before mounting a plain FileDiff; its first hydrate can
// then render synchronously without a worker or Virtualizer ancestor.
export function SingleFileDiffBody(props: { fileDiff: FileDiffMetadata; theme: "light" | "dark" }) {
  const themeName = resolveDiffThemeName(props.theme);
  const language = props.fileDiff.lang ?? getFiletypeFromFileName(props.fileDiff.name);
  const preloadKey = `${themeName}:${language}`;
  const [loadResult, setLoadResult] = useState<{ key: string; error?: Error } | null>(null);
  const resourcesReady =
    isHighlighterLoaded() && areThemesAttached(themeName) && areLanguagesAttached(language);

  useEffect(() => {
    if (resourcesReady) return;

    let active = true;
    void preloadHighlighter({ themes: [themeName], langs: [language] }).then(
      () => {
        if (active) setLoadResult({ key: preloadKey });
      },
      (cause: unknown) => {
        if (!active) return;
        setLoadResult({
          key: preloadKey,
          error:
            cause instanceof Error
              ? cause
              : new Error(`Failed to initialize diff highlighting: ${String(cause)}`),
        });
      },
    );

    return () => {
      active = false;
    };
  }, [language, preloadKey, resourcesReady, themeName]);

  if (loadResult?.key === preloadKey && loadResult.error) {
    return (
      <div className="px-3 py-2 text-xs text-destructive" role="alert">
        Could not render this diff: {loadResult.error.message}
      </div>
    );
  }

  if (!resourcesReady) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground" role="status">
        Rendering diff…
      </div>
    );
  }

  return (
    <FileDiff
      key={preloadKey}
      fileDiff={props.fileDiff}
      options={{
        diffStyle: "unified",
        lineDiffType: "none",
        overflow: "scroll",
        theme: themeName,
        themeType: props.theme,
        unsafeCSS: buildDiffPanelUnsafeCSS(props.theme),
        disableFileHeader: true,
      }}
      disableWorkerPool
    />
  );
}

import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/inter";
import "./index.css";

import { appHistory } from "./appNavigation";
import { revealHubsRailItemOnce } from "./appSettings";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";
import { initializeEmbedMode } from "./embedMode";
import { startLatticeAgentQualityRelay } from "./latticeAgentQualityRelay";
import { startLatticeHostWritesRelay } from "./latticeHostWritesRelay";
import { answerLatticeBibliographyRequest } from "./latticeBibliographyRelay";
import { answerLatticeCanvasRequest } from "./latticeCanvasRelay";
import { answerLatticeSpreadsheetRequest } from "./latticeSpreadsheetRelay";
import { answerLatticeProjectDocumentRequest } from "./latticeProjectDocumentRelay";
import { answerLatticeEditorCommentsRequest } from "./latticeEditorCommentsRelay";
import { answerLatticePresentationRequest } from "./latticePresentationRelay";
import { startLatticeHostToolRelay } from "./latticeHostToolRelay";
import { startLatticeHostThemeRelay } from "./latticeHostThemeRelay";
import { startLatticePopupDismissal } from "./latticePopupDismissal";
import { startLatticeHostShortcuts } from "./latticeHostShortcuts";
import { isElectron } from "./env";
import { readDesktopWindowTranslucency } from "./lib/desktopWindowTranslucency";
import { installGlassOverlayCutout } from "./lib/glassOverlayCutout";
import { installRendererErrorDiagnostics } from "./lib/rendererErrorDiagnostics";
import { initializeI18n } from "./i18n";

// The embed handshake carries Lattice's language, so it is read before i18n starts.
initializeEmbedMode();
const disposeI18n = initializeI18n();
if (import.meta.hot) import.meta.hot.dispose(disposeI18n);

const disposeRendererDiagnostics = installRendererErrorDiagnostics();
if (import.meta.hot) import.meta.hot.dispose(() => disposeRendererDiagnostics?.());
startLatticeAgentQualityRelay();
startLatticeHostWritesRelay();
startLatticeHostToolRelay({
  bibliography: answerLatticeBibliographyRequest,
  canvas: answerLatticeCanvasRequest,
  spreadsheet: answerLatticeSpreadsheetRequest,
  projectDocument: answerLatticeProjectDocumentRequest,
  editorComments: answerLatticeEditorCommentsRequest,
  presentation: answerLatticePresentationRequest,
});
startLatticeHostThemeRelay();
startLatticePopupDismissal();
// Before the first render, so Lattice's keys are stopped ahead of every shortcut listener here.
startLatticeHostShortcuts();
// Before the first render: settings hooks read the stored rail on mount.
revealHubsRailItemOnce();
const router = getRouter(appHistory);
const rootElement = document.getElementById("root") as HTMLElement;

document.title = APP_DISPLAY_NAME;

if (isElectron) {
  document.documentElement.dataset.runtime = "electron";
  // Desktop windows backed by macOS vibrancy or the Hyprland compositor blur are transparent
  // (see getWindowMaterialOptions in apps/desktop). A `backdrop-filter` cannot hide page
  // content over a see-through region there, so floating overlays get the page cut out from
  // under them instead.
  if (readDesktopWindowTranslucency() !== null) {
    document.documentElement.dataset.windowTransparent = "true";
    const disposeGlassOverlayCutout = installGlassOverlayCutout(rootElement);
    if (import.meta.hot) import.meta.hot.dispose(disposeGlassOverlayCutout);
  }
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);

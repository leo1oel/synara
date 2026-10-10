import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { I18nProvider } from "@lingui/react";

import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/inter";
import "./index.css";

import { appHistory } from "./appNavigation";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";
import { initializeEmbedMode } from "./embedMode";
import { startLatticeAgentQualityRelay } from "./latticeAgentQualityRelay";
import { answerLatticeBibliographyRequest } from "./latticeBibliographyRelay";
import { answerLatticeCanvasRequest } from "./latticeCanvasRelay";
import { answerLatticeSpreadsheetRequest } from "./latticeSpreadsheetRelay";
import { answerLatticeProjectDocumentRequest } from "./latticeProjectDocumentRelay";
import { answerLatticeEditorCommentsRequest } from "./latticeEditorCommentsRelay";
import { answerLatticePresentationRequest } from "./latticePresentationRelay";
import { startLatticeHostToolRelay } from "./latticeHostToolRelay";
import { startLatticeHostThemeRelay } from "./latticeHostThemeRelay";
import { isElectron } from "./env";
import { isMacPlatform } from "./lib/utils";
import { installGlassOverlayCutout } from "./lib/glassOverlayCutout";
import { installRendererErrorDiagnostics } from "./lib/rendererErrorDiagnostics";

const disposeRendererDiagnostics = installRendererErrorDiagnostics();
if (import.meta.hot) import.meta.hot.dispose(() => disposeRendererDiagnostics?.());
import { activateInitialLocale, i18n } from "./i18n";

initializeEmbedMode();
await activateInitialLocale();
startLatticeAgentQualityRelay();
startLatticeHostToolRelay({
  bibliography: answerLatticeBibliographyRequest,
  canvas: answerLatticeCanvasRequest,
  spreadsheet: answerLatticeSpreadsheetRequest,
  projectDocument: answerLatticeProjectDocumentRequest,
  editorComments: answerLatticeEditorCommentsRequest,
  presentation: answerLatticePresentationRequest,
});
startLatticeHostThemeRelay();
const router = getRouter(appHistory);
const rootElement = document.getElementById("root") as HTMLElement;

document.title = APP_DISPLAY_NAME;

if (isElectron) {
  document.documentElement.dataset.runtime = "electron";
  // macOS desktop windows are transparent vibrancy windows (see getWindowMaterialOptions
  // in apps/desktop). A `backdrop-filter` cannot hide page content over a see-through
  // region there, so floating overlays get the page cut out from under them instead.
  if (isMacPlatform(navigator.platform)) {
    document.documentElement.dataset.windowTransparent = "true";
    const disposeGlassOverlayCutout = installGlassOverlayCutout(rootElement);
    if (import.meta.hot) import.meta.hot.dispose(disposeGlassOverlayCutout);
  }
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <I18nProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nProvider>
  </React.StrictMode>,
);

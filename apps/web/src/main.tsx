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
import { startLatticeBibliographyRelay } from "./latticeBibliographyRelay";
import { startLatticeCanvasRelay } from "./latticeCanvasRelay";
import { startLatticeSpreadsheetRelay } from "./latticeSpreadsheetRelay";
import { startLatticeProjectDocumentRelay } from "./latticeProjectDocumentRelay";
import { isElectron } from "./env";
import { isMacPlatform } from "./lib/utils";
import { activateInitialLocale, i18n } from "./i18n";

initializeEmbedMode();
await activateInitialLocale();
startLatticeAgentQualityRelay();
startLatticeBibliographyRelay();
startLatticeCanvasRelay();
startLatticeSpreadsheetRelay();
startLatticeProjectDocumentRelay();
const router = getRouter(appHistory);

document.title = APP_DISPLAY_NAME;

if (isElectron) {
  document.documentElement.dataset.runtime = "electron";
  // macOS desktop windows are transparent vibrancy windows (see getWindowMaterialOptions
  // in apps/desktop), and Chromium cannot render `backdrop-filter` inside transparent
  // windows — frosted surfaces must fall back to a more opaque fill (see index.css).
  if (isMacPlatform(navigator.platform)) {
    document.documentElement.dataset.windowTransparent = "true";
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nProvider>
  </React.StrictMode>,
);

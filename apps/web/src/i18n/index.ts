import { useMemo } from "react";
import { createInstance } from "i18next";
import { initReactI18next, useTranslation as useReactTranslation } from "react-i18next";

import { uiLocalizationResources } from "@synara/shared/uiLocalizationResources";
import { UI_LOCALES, isUiMessageKey } from "@synara/shared/uiLocale";
import { readEmbedMode } from "../embedMode";
import latticeZhOverrides from "./latticeZhOverrides.json";

// Upstream's interface is English-only. Lattice's embedded panel keeps reading in the
// language Lattice puts in the handshake (`?locale=`), whatever the OS language says;
// the zh-CN catalogs exist only for it. A language change in Lattice loads a new frame.
function hostLocale(): (typeof UI_LOCALES)[number] | null {
  try {
    return readEmbedMode()?.locale ?? null;
  } catch {
    // Storage access can fail before the handshake exists; the app then reads English.
    return null;
  }
}

// Boot code can import this module before main.tsx reads the handshake, so main applies
// the host language again (applyHostLocale) before the first render.
let activeHostLocale = hostLocale();

export const i18n = createInstance();
void i18n.use(initReactI18next).init({
  lng: activeHostLocale ?? "en",
  fallbackLng: "en",
  supportedLngs: [...UI_LOCALES],
  resources: uiLocalizationResources,
  ns: Object.keys(uiLocalizationResources.en),
  defaultNS: "common",
  initAsync: false,
  keySeparator: false,
  nsSeparator: ":",
  interpolation: { escapeValue: false },
  react: { useSuspense: false, transSupportBasicHtmlNodes: false },
});

// Lattice keeps its own wording where the Chinese catalogs contradict Lattice's terminology
// (PR, AI/助手, 工作树, Skills) or the meaning in context. See latticeZhOverrides.json.
for (const [namespace, entries] of Object.entries(latticeZhOverrides)) {
  i18n.addResourceBundle("zh-CN", namespace, entries, true, true);
}

/** Switches to the language in Lattice's handshake; standalone Synara stays English. */
export function applyHostLocale(): void {
  activeHostLocale = hostLocale();
  if (!activeHostLocale) return;
  if (i18n.language !== activeHostLocale) void i18n.changeLanguage(activeHostLocale);
  if (typeof document !== "undefined") document.documentElement.lang = activeHostLocale;
}

/** Switches the runtime language directly (tests); "system" reads English, as upstream does. */
export function setLanguagePreference(locale: "system" | (typeof UI_LOCALES)[number]): void {
  void i18n.changeLanguage(locale === "system" ? "en" : locale);
}

export function t(message: string, values?: Record<string, unknown>): string {
  if (!isUiMessageKey(message, uiLocalizationResources.en)) return message;
  return i18n.t(message, { ...values, returnObjects: false });
}

// A factory call ties identity to the subscription value without closing over its old
// state. An unused useCallback dependency is removed by React Compiler.
function createTranslationSnapshot(_subscription: unknown): { t: typeof t; formatLocale: string } {
  return {
    t: (message, values) => t(message, values),
    formatLocale: getFormatLocale(),
  };
}

export function useTranslation(): { t: typeof t; locale: string; formatLocale: string } {
  const { t: reactiveTranslator, i18n: instance } = useReactTranslation(undefined, { i18n });
  const snapshot = useMemo(
    () => createTranslationSnapshot(reactiveTranslator),
    [reactiveTranslator],
  );
  return { ...snapshot, locale: instance.language };
}

// Resolved once, like the formatters that used an unspecified `Intl` locale before.
const SYSTEM_FORMAT_LOCALE = new Intl.DateTimeFormat().resolvedOptions().locale;

/**
 * Dates and numbers follow the system locale, as an unspecified `Intl` locale does; in
 * Lattice's panel they follow the host language, so a Chinese panel reads Chinese dates.
 */
export function getFormatLocale(): string {
  return activeHostLocale ?? SYSTEM_FORMAT_LOCALE;
}

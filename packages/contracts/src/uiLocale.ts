/**
 * Upstream's interface is English-only; catalogs live under `packages/shared/src/locales/en`.
 * Lattice's fork keeps zh-CN catalogs for its embedded panel, which follows Lattice's language.
 */
export const UI_LOCALES = ["en", "zh-CN"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

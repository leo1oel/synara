import { setupI18n } from "@lingui/core";
import { readEmbedMode } from "./embedMode";

export const i18n = setupI18n();
let activation = 0;

export async function activateInitialLocale(): Promise<void> {
  const requested = readEmbedMode()?.locale ?? "en";
  const generation = ++activation;
  const messages =
    requested === "zh-CN"
      ? (await import("./locales/zh-CN/messages.po")).messages
      : (await import("./locales/en/messages.po")).messages;
  if (generation !== activation) return;
  i18n.loadAndActivate({ locale: requested, messages });
  document.documentElement.lang = requested;
}

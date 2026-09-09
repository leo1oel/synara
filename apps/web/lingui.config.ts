import type { LinguiConfig } from "@lingui/conf";
import { formatter } from "@lingui/format-po";

export default {
  sourceLocale: "en",
  locales: ["en", "zh-CN"],
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: ["<rootDir>/src"],
      exclude: ["**/__screenshots__/**"],
    },
  ],
  format: formatter({ lineNumbers: false }),
} satisfies LinguiConfig;

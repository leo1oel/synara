import { readFile } from "node:fs/promises";

const catalog = await readFile(
  new URL("../src/locales/zh-CN/messages.po", import.meta.url),
  "utf8",
);
const entries = catalog.split(/\n\n+/u).filter((entry) => /^msgid /mu.test(entry));
const missing = entries.filter(
  (entry) => !/^msgid ""$/mu.test(entry) && /^msgstr ""$/mu.test(entry),
);
const fuzzy = entries.filter((entry) => /^#,.*\bfuzzy\b/mu.test(entry));
const summarize = (entry: string) => entry.match(/^msgid "(.*)"$/mu)?.[1] ?? "(multiline message)";
if (missing.length || fuzzy.length) {
  if (missing.length)
    console.error(`Missing zh-CN translations:\n${missing.map(summarize).join("\n")}`);
  if (fuzzy.length) console.error(`Fuzzy zh-CN translations:\n${fuzzy.map(summarize).join("\n")}`);
  process.exit(1);
}
console.log("zh-CN extracted catalog coverage: complete (no missing or fuzzy messages)");

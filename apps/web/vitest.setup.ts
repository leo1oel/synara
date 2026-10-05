// FILE: vitest.setup.ts
// Purpose: Give unit tests the two globals the app assumes at import time —
//          a real localStorage and an activated Lingui catalog.
// Layer: Test support

import { createElement } from "react";
import { vi } from "vitest";

import { messages } from "./src/locales/en/messages.po";
import { i18n } from "./src/i18n";

type MemoryStorage = Pick<
  Storage,
  "clear" | "getItem" | "key" | "length" | "removeItem" | "setItem"
>;

function createMemoryStorage(): MemoryStorage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

// Node 24+ exposes an experimental localStorage getter that resolves to
// undefined unless --localstorage-file is supplied. Zustand snapshots that
// undefined value while modules load, before individual tests can stub it.
if (!globalThis.localStorage) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: createMemoryStorage(),
    writable: true,
  });
}

// `main.tsx` activates the catalog before the router mounts; tests render
// components directly, so the same has to happen here or every `i18n._` call
// throws "without setting a locale".
i18n.loadAndActivate({ locale: "en", messages });

// Several tests render through `renderToString`, which leaves no room for an
// I18nProvider. Point the hook at the instance activated above instead of
// asking each test to wrap its tree.
vi.mock("@lingui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lingui/react")>();
  const { TransNoContext } = await import("@lingui/react/server");
  const lingui = { i18n, _: i18n._.bind(i18n), defaultComponent: undefined };
  return {
    ...actual,
    useLingui: () => lingui,
    Trans: (props: Parameters<typeof TransNoContext>[0]) =>
      createElement(TransNoContext, { ...props, lingui }),
  };
});

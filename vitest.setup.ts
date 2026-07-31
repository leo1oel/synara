type MemoryStorage = Pick<Storage, "clear" | "getItem" | "key" | "length" | "removeItem" | "setItem">;

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

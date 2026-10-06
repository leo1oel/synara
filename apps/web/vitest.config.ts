// FILE: vitest.config.ts
// Purpose: Run the unit suite with the shared test setup.
// Layer: Test config
//
// The setup has to hang off a vitest-only config rather than `vite.config.ts`:
// the browser suites merge that file directly, and they need neither the
// localStorage shim nor the mocked Lingui hook.

import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      setupFiles: [fileURLToPath(new URL("./vitest.setup.ts", import.meta.url))],
    },
  }),
);

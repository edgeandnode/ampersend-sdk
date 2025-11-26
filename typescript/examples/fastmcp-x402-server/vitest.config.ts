import path from "node:path"

import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@ampersend_ai/ampersend-sdk": path.resolve(__dirname, "../../packages/ampersend-sdk/src"),
    },
  },
})

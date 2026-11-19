import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    env: { STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: "./.test-storage" },
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/setup-env.ts"],
        },
      },
    ],
  },
});

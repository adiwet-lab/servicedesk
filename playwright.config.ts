import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);

/**
 * E2E tests drive the real app through the developer login (AUTH_DEV_LOGIN=true,
 * non-production). Run against a seeded database: `pnpm db:seed && pnpm test:e2e`.
 * Tests create uniquely-named data and restore anything they change.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "warmup", testMatch: /warmup\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["warmup"] },
  ],
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { AUTH_DEV_LOGIN: "true", PORT: String(PORT), APP_URL: `http://localhost:${PORT}`, NODE_OPTIONS: "--max-old-space-size=6144" },
  },
});

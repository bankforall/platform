import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E against the real stack: web (vite :5173) → API (:4000) → Postgres/Redis/MinIO → anvil (:58545).
 * Start the stack first (see apps/web/README.md "End-to-end tests").
 */
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    ...devices["Pixel 7"],
    viewport: { width: 390, height: 844 },
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
  },
  projects: [{ name: "chromium-mobile", use: { browserName: "chromium" } }],
});

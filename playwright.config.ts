import { defineConfig, devices } from "@playwright/test";

process.env.BETTER_AUTH_SECRET ??=
  "playwright-test-only-better-auth-secret-32-chars";

/**
 * Phase 16 release-test topology.
 *
 * - `api` keeps the historical HTTP-boundary suite fast and browser-free.
 * - `chromium` runs true rendered customer/admin journeys.
 * - `mobile-chromium` runs the focused responsive/visual smoke slice.
 *
 * Keeping these as separate projects avoids multiplying the large API suite
 * across device profiles while still making browser behavior a release gate.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [
        ["list"],
        ["html", { outputFolder: "playwright-report", open: "never" }],
      ],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "api",
      testIgnore: /browser\//,
    },
    {
      name: "chromium",
      testMatch: /browser\/.*\.browser\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      testMatch: /browser\/.*\.responsive\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "npm run build && npm start -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});

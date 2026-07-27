import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

const applicationUrl = "http://127.0.0.1:4173";
const providerUrl = "http://127.0.0.1:4174";
const botToken = "123456789:e2e_test_bot_token_abcdefghijklmnopqrstuvwxyz";

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: "test-results",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  retries: process.env.CI ? 1 : 0,
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: applicationUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "tsx scripts/e2e-provider-server.ts",
      name: "provider-stubs",
      reuseExistingServer: false,
      timeout: 30_000,
      url: `${providerUrl}/healthz`,
    },
    {
      command: "npm run e2e:serve",
      env: {
        DATABASE_URL: resolve("data/e2e.sqlite"),
        ENABLE_DEV_MOCK_AUTH: "false",
        ENABLE_LIVE_OPERATIONS: "true",
        INTERNAL_JOB_SECRET: "j".repeat(32),
        MARZBAN_BASE_URL: providerUrl,
        MARZBAN_PASSWORD: "e2e-marzban-password",
        MARZBAN_USERNAME: "e2e-operator",
        MARZBAN_VLESS_INBOUND_TAG: "VLESS_TCP_REALITY_V1",
        NODE_ENV: "test",
        ORIGIN: applicationUrl,
        SESSION_SECRET: "s".repeat(64),
        SUBSCRIPTION_URL_ENCRYPTION_KEY: "e".repeat(43),
        TELEGRAM_ADMIN_USER_ID: "999999999",
        TELEGRAM_API_BASE_URL: providerUrl,
        TELEGRAM_BOT_TOKEN: botToken,
        TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: "300",
        TELEGRAM_WEBHOOK_SECRET: "w".repeat(32),
      },
      name: "application",
      reuseExistingServer: false,
      timeout: 60_000,
      url: `${applicationUrl}/healthz`,
    },
  ],
  workers: 1,
});

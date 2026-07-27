import { describe, expect, it } from "vitest";

import { parseRuntimeConfig } from "../../src/lib/server/config/schema";

const SESSION_SECRET = "test-session-secret-with-at-least-32-chars";
const PRODUCTION_ENVIRONMENT = {
  BACKUP_STATUS_FILE: "/data/backup-status.json",
  BASE_DOMAIN: "astra-vpn.ru",
  DATABASE_URL: "/data/astra-vpn.sqlite",
  NODE_ENV: "production",
  MONITORING_SECRET: "m".repeat(32),
  ORIGIN: "https://app.astra-vpn.ru",
  SESSION_SECRET: "s".repeat(64),
  TELEGRAM_ADMIN_USER_ID: "123456789",
  TELEGRAM_BOT_TOKEN: "123456789:test_bot_token_value_123456789",
} as const;

describe("parseRuntimeConfig", () => {
  it("allows explicit development mock authentication", () => {
    const config = parseRuntimeConfig({
      ENABLE_DEV_MOCK_AUTH: "true",
      NODE_ENV: "development",
      ORIGIN: "",
      SESSION_SECRET,
      TELEGRAM_BOT_TOKEN: "",
    });

    expect(config.developmentMock.enabled).toBe(true);
    expect(config.telegramBotToken).toBeUndefined();
  });

  it("fails closed when mock authentication is enabled in production", () => {
    expect(() =>
      parseRuntimeConfig({
        ...PRODUCTION_ENVIRONMENT,
        ENABLE_DEV_MOCK_AUTH: "true",
      }),
    ).toThrowError(
      expect.objectContaining({
        fields: ["ENABLE_DEV_MOCK_AUTH"],
      }),
    );
  });

  it("requires HTTPS origin in production", () => {
    expect(() =>
      parseRuntimeConfig({
        ...PRODUCTION_ENVIRONMENT,
        ORIGIN: "http://app.example.com",
      }),
    ).toThrowError(
      expect.objectContaining({
        fields: ["ORIGIN"],
      }),
    );
  });

  it("uses the official Telegram API endpoint outside tests", () => {
    const config = parseRuntimeConfig({
      ENABLE_DEV_MOCK_AUTH: "true",
      NODE_ENV: "development",
      SESSION_SECRET,
    });

    expect(config.telegramApiBaseUrl).toBe("https://api.telegram.org");
  });

  it("only allows overriding the Telegram API endpoint in tests", () => {
    expect(() =>
      parseRuntimeConfig({
        ENABLE_DEV_MOCK_AUTH: "true",
        NODE_ENV: "development",
        SESSION_SECRET,
        TELEGRAM_API_BASE_URL: "http://127.0.0.1:4174",
      }),
    ).toThrowError(
      expect.objectContaining({
        fields: ["TELEGRAM_API_BASE_URL"],
      }),
    );

    expect(
      parseRuntimeConfig({
        ENABLE_DEV_MOCK_AUTH: "true",
        NODE_ENV: "test",
        SESSION_SECRET,
        TELEGRAM_API_BASE_URL: "http://127.0.0.1:4174/",
      }).telegramApiBaseUrl,
    ).toBe("http://127.0.0.1:4174");
  });

  it("requires a Telegram bot token when mock auth is disabled", () => {
    expect(() =>
      parseRuntimeConfig({
        ENABLE_DEV_MOCK_AUTH: "false",
        NODE_ENV: "development",
        SESSION_SECRET,
      }),
    ).toThrowError(
      expect.objectContaining({
        fields: ["TELEGRAM_BOT_TOKEN"],
      }),
    );
  });

  it("requires the Telegram administrator in production", () => {
    expect(() =>
      parseRuntimeConfig({
        ...PRODUCTION_ENVIRONMENT,
        TELEGRAM_ADMIN_USER_ID: "",
      }),
    ).toThrowError(
      expect.objectContaining({
        fields: ["TELEGRAM_ADMIN_USER_ID"],
      }),
    );
  });

  it("requires every provider secret before live operations are enabled", () => {
    expect(() =>
      parseRuntimeConfig({
        ENABLE_DEV_MOCK_AUTH: "false",
        ENABLE_LIVE_OPERATIONS: "true",
        NODE_ENV: "development",
        SESSION_SECRET,
      }),
    ).toThrowError(
      expect.objectContaining({
        fields: [
          "INTERNAL_JOB_SECRET",
          "MARZBAN_BASE_URL",
          "MARZBAN_PASSWORD",
          "MARZBAN_USERNAME",
          "SUBSCRIPTION_URL_ENCRYPTION_KEY",
          "TELEGRAM_BOT_TOKEN",
          "TELEGRAM_WEBHOOK_SECRET",
        ],
      }),
    );
  });

  it("blocks production live operations while evidence gates are pending", () => {
    expect(() =>
      parseRuntimeConfig({
        ...PRODUCTION_ENVIRONMENT,
        ENABLE_LIVE_OPERATIONS: "true",
        INTERNAL_JOB_SECRET: "j".repeat(32),
        MARZBAN_BASE_URL: "http://marzban:8000",
        MARZBAN_PASSWORD: "marzban-password",
        MARZBAN_USERNAME: "operator",
        SUBSCRIPTION_URL_ENCRYPTION_KEY: "e".repeat(43),
        TELEGRAM_WEBHOOK_SECRET: "w".repeat(32),
      }),
    ).toThrowError(
      expect.objectContaining({
        fields: ["ENABLE_LIVE_OPERATIONS"],
      }),
    );
  });
});

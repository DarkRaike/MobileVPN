import { describe, expect, it } from "vitest";

import { parseRuntimeConfig } from "../../src/lib/server/config/schema";

const SESSION_SECRET = "test-session-secret-with-at-least-32-chars";

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
        ENABLE_DEV_MOCK_AUTH: "true",
        NODE_ENV: "production",
        ORIGIN: "https://app.example.com",
        SESSION_SECRET,
        TELEGRAM_ADMIN_USER_ID: "123456789",
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
        NODE_ENV: "production",
        ORIGIN: "http://app.example.com",
        SESSION_SECRET,
        TELEGRAM_ADMIN_USER_ID: "123456789",
        TELEGRAM_BOT_TOKEN: "123456789:test_bot_token_value_123456789",
      }),
    ).toThrowError(
      expect.objectContaining({
        fields: ["ORIGIN"],
      }),
    );
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
        ENABLE_DEV_MOCK_AUTH: "false",
        NODE_ENV: "production",
        ORIGIN: "https://app.example.com",
        SESSION_SECRET,
        TELEGRAM_BOT_TOKEN: "123456789:test_bot_token_value_123456789",
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
        ENABLE_DEV_MOCK_AUTH: "true",
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
});

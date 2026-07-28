import { describe, expect, it } from "vitest";

import { createDevelopmentEnvironment } from "../../scripts/dev-environment";
import { parseRuntimeConfig } from "../../src/lib/server/config/schema";

const GENERATED_SESSION_SECRET = "s".repeat(64);

describe("createDevelopmentEnvironment", () => {
  it("creates a runnable local configuration when no environment file exists", () => {
    const result = createDevelopmentEnvironment(
      {},
      () => GENERATED_SESSION_SECRET,
    );
    const config = parseRuntimeConfig(result.environment);

    expect(result.generatedSessionSecret).toBe(true);
    expect(result.enabledMockAuthentication).toBe(true);
    expect(config.databaseUrl).toBe("./data/astra-vpn.sqlite");
    expect(config.developmentMock.enabled).toBe(true);
    expect(config.sessionSecret).toBe(GENERATED_SESSION_SECRET);
  });

  it("preserves explicit Telegram development configuration", () => {
    const result = createDevelopmentEnvironment({
      DATABASE_URL: "./data/custom.sqlite",
      ENABLE_DEV_MOCK_AUTH: "false",
      NODE_ENV: "development",
      SESSION_SECRET: "configured-session-secret-with-at-least-32-chars",
      TELEGRAM_BOT_TOKEN: "123456789:test_bot_token_value_123456789",
    });

    expect(result.generatedSessionSecret).toBe(false);
    expect(result.enabledMockAuthentication).toBe(false);
    expect(result.environment).toMatchObject({
      DATABASE_URL: "./data/custom.sqlite",
      ENABLE_DEV_MOCK_AUTH: "false",
      NODE_ENV: "development",
      SESSION_SECRET: "configured-session-secret-with-at-least-32-chars",
      TELEGRAM_BOT_TOKEN: "123456789:test_bot_token_value_123456789",
    });
  });

  it("does not override an explicitly disabled mock without a bot token", () => {
    const result = createDevelopmentEnvironment(
      {
        ENABLE_DEV_MOCK_AUTH: "false",
      },
      () => GENERATED_SESSION_SECRET,
    );

    expect(result.enabledMockAuthentication).toBe(false);
    expect(result.environment.ENABLE_DEV_MOCK_AUTH).toBe("false");
    expect(() => parseRuntimeConfig(result.environment)).toThrowError(
      expect.objectContaining({
        fields: ["TELEGRAM_BOT_TOKEN"],
      }),
    );
  });

  it("refuses to run the development launcher with production settings", () => {
    expect(() =>
      createDevelopmentEnvironment({
        NODE_ENV: "production",
      }),
    ).toThrowError(
      "The development server cannot run with NODE_ENV=production",
    );
  });
});

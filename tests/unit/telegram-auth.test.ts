import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { validateTelegramInitData } from "../../src/lib/server/auth/telegram";

const BOT_TOKEN = "123456789:test_bot_token_value_123456789";
const NOW = new Date("2026-07-27T12:00:00.000Z");

function createInitData(overrides: Record<string, string> = {}): string {
  const parameters = new Map<string, string>([
    ["auth_date", String(Math.floor(NOW.getTime() / 1000))],
    ["query_id", "AAHdF6IQAAAAAN0XohDhrOrc"],
    ["signature", "dGVsZWdyYW0tdGhpcmQtcGFydHktc2lnbmF0dXJl"],
    [
      "user",
      JSON.stringify({
        first_name: "Daniil",
        id: 4503599627370495,
        language_code: "ru",
        last_name: "Zhurik",
        photo_url: "https://t.me/i/userpic/320/example.svg",
        username: "darkraike",
      }),
    ],
  ]);

  for (const [key, value] of Object.entries(overrides)) {
    parameters.set(key, value);
  }

  const dataCheckString = [...parameters.entries()]
    .filter(([key]) => key !== "hash" && key !== "signature")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  const query = new URLSearchParams([...parameters, ["hash", hash]]);

  return query.toString();
}

describe("validateTelegramInitData", () => {
  it("validates the signature and preserves the user id as text", () => {
    const result = validateTelegramInitData(
      createInitData(),
      BOT_TOKEN,
      300,
      NOW,
    );

    expect(result.user).toEqual({
      firstName: "Daniil",
      id: "4503599627370495",
      languageCode: "ru",
      lastName: "Zhurik",
      photoUrl: "https://t.me/i/userpic/320/example.svg",
      username: "darkraike",
    });
    expect(result.authDate).toEqual(NOW);
  });

  it("rejects a modified hash", () => {
    const initData = new URLSearchParams(createInitData());
    initData.set("hash", "0".repeat(64));

    expect(() =>
      validateTelegramInitData(initData.toString(), BOT_TOKEN, 300, NOW),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTH_INIT_DATA_INVALID",
      }),
    );
  });

  it("rejects stale init data", () => {
    const staleAuthDate = String(Math.floor(NOW.getTime() / 1000) - 301);

    expect(() =>
      validateTelegramInitData(
        createInitData({ auth_date: staleAuthDate }),
        BOT_TOKEN,
        300,
        NOW,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTH_INIT_DATA_EXPIRED",
      }),
    );
  });

  it("rejects a future auth date outside the clock-skew allowance", () => {
    const futureAuthDate = String(Math.floor(NOW.getTime() / 1000) + 31);

    expect(() =>
      validateTelegramInitData(
        createInitData({ auth_date: futureAuthDate }),
        BOT_TOKEN,
        300,
        NOW,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTH_INIT_DATA_INVALID",
      }),
    );
  });

  it("rejects duplicate parameters", () => {
    const initData = `${createInitData()}&auth_date=${Math.floor(
      NOW.getTime() / 1000,
    )}`;

    expect(() =>
      validateTelegramInitData(initData, BOT_TOKEN, 300, NOW),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTH_INIT_DATA_INVALID",
      }),
    );
  });

  it("rejects malformed user data after signature validation", () => {
    expect(() =>
      validateTelegramInitData(
        createInitData({ user: JSON.stringify({ id: "123" }) }),
        BOT_TOKEN,
        300,
        NOW,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTH_INIT_DATA_INVALID",
      }),
    );
  });
});

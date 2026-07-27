import { describe, expect, it } from "vitest";

import { isTelegramVersionAtLeast } from "../../src/lib/telegram/web-app";

describe("isTelegramVersionAtLeast", () => {
  it.each([
    ["6.1", "6.1", true],
    ["6.1.0", "6.1", true],
    ["6.10", "6.9", true],
    ["9.6", "6.1", true],
    ["6.0", "6.1", false],
    ["5.10", "6.1", false],
    ["unknown", "6.1", false],
  ])(
    "compares Telegram version %s against %s",
    (current, minimum, expected) => {
      expect(isTelegramVersionAtLeast(current, minimum)).toBe(expected);
    },
  );
});

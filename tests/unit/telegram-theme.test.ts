import { describe, expect, it } from "vitest";

import {
  isTelegramColor,
  resolveTelegramTheme,
} from "../../src/lib/telegram/theme";

describe("isTelegramColor", () => {
  it.each(["#151616", "#4d96ff", "#ABCDEF"])(
    "accepts Telegram hex color %s",
    (color) => {
      expect(isTelegramColor(color)).toBe(true);
    },
  );

  it.each(["red", "#fff", "#12345678", "url(javascript:alert(1))", null])(
    "rejects unsafe theme value %s",
    (color) => {
      expect(isTelegramColor(color)).toBe(false);
    },
  );
});

describe("resolveTelegramTheme", () => {
  it("uses modern Telegram section colors when available", () => {
    expect(
      resolveTelegramTheme({
        bg_color: "#111111",
        section_bg_color: "#222222",
        secondary_bg_color: "#333333",
      }),
    ).toMatchObject({
      "--color-app": "#111111",
      "--color-card": "#222222",
      "--color-card-raised": "#333333",
    });
  });

  it("falls back to legacy background colors on older clients", () => {
    expect(
      resolveTelegramTheme({
        bg_color: "#f5f5f5",
        link_color: "#168acd",
        secondary_bg_color: "#ffffff",
      }),
    ).toMatchObject({
      "--color-app": "#f5f5f5",
      "--color-card": "#ffffff",
      "--color-card-raised": "#ffffff",
      "--color-accent": "#168acd",
      "--color-accent-text": "#168acd",
    });
  });
});

import type { TelegramThemeParams, TelegramWebApp } from "./web-app";

const TELEGRAM_COLOR_PATTERN = /^#[\da-f]{6}$/i;

const themeVariables = [
  { cssVariable: "--color-app", keys: ["bg_color"] },
  {
    cssVariable: "--color-card",
    keys: ["section_bg_color", "secondary_bg_color", "bg_color"],
  },
  {
    cssVariable: "--color-card-raised",
    keys: ["secondary_bg_color", "section_bg_color", "bg_color"],
  },
  { cssVariable: "--color-text", keys: ["text_color"] },
  { cssVariable: "--color-muted", keys: ["hint_color"] },
  { cssVariable: "--color-accent", keys: ["button_color", "link_color"] },
  {
    cssVariable: "--color-accent-text",
    keys: ["accent_text_color", "link_color", "button_color"],
  },
  { cssVariable: "--color-button-text", keys: ["button_text_color"] },
  { cssVariable: "--color-border", keys: ["section_separator_color"] },
] as const;

type ThemeCssVariable = (typeof themeVariables)[number]["cssVariable"];

export function isTelegramColor(value: unknown): value is string {
  return typeof value === "string" && TELEGRAM_COLOR_PATTERN.test(value);
}

export function resolveTelegramTheme(
  themeParams: TelegramThemeParams,
): Partial<Record<ThemeCssVariable, string>> {
  const theme: Partial<Record<ThemeCssVariable, string>> = {};

  for (const { cssVariable, keys } of themeVariables) {
    for (const key of keys) {
      const value = themeParams[key];

      if (isTelegramColor(value)) {
        theme[cssVariable] = value;
        break;
      }
    }
  }

  return theme;
}

export function applyTelegramTheme(webApp: TelegramWebApp): void {
  const root = document.documentElement;
  const theme = resolveTelegramTheme(webApp.themeParams);

  root.dataset.telegramTheme = webApp.colorScheme;
  root.style.colorScheme = webApp.colorScheme;

  for (const { cssVariable } of themeVariables) {
    const value = theme[cssVariable];

    if (value) {
      root.style.setProperty(cssVariable, value);
    } else {
      root.style.removeProperty(cssVariable);
    }
  }

  const backgroundColor = webApp.themeParams.bg_color;
  const headerColor = webApp.themeParams.header_bg_color ?? backgroundColor;
  const bottomBarColor =
    webApp.themeParams.bottom_bar_bg_color ?? backgroundColor;

  if (isTelegramColor(backgroundColor)) {
    webApp.setBackgroundColor?.(backgroundColor);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", backgroundColor);
  }

  if (isTelegramColor(headerColor)) {
    webApp.setHeaderColor?.(headerColor);
  }

  if (isTelegramColor(bottomBarColor)) {
    webApp.setBottomBarColor?.(bottomBarColor);
  }
}

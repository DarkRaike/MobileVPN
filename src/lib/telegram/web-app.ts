export interface TelegramThemeParams {
  accent_text_color?: string;
  bg_color?: string;
  bottom_bar_bg_color?: string;
  button_color?: string;
  button_text_color?: string;
  header_bg_color?: string;
  hint_color?: string;
  link_color?: string;
  secondary_bg_color?: string;
  section_bg_color?: string;
  section_separator_color?: string;
  text_color?: string;
}

interface TelegramBackButton {
  hide(): void;
  offClick(callback: () => void): void;
  onClick(callback: () => void): void;
  show(): void;
}

export interface TelegramWebApp {
  BackButton?: TelegramBackButton;
  colorScheme: "dark" | "light";
  expand(): void;
  initData: string;
  offEvent(event: "themeChanged", callback: () => void): void;
  onEvent(event: "themeChanged", callback: () => void): void;
  ready(): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  setHeaderColor?(color: string): void;
  themeParams: TelegramThemeParams;
  version: string;
}

export function getTelegramWebApp(): TelegramWebApp | undefined {
  return window.Telegram?.WebApp;
}

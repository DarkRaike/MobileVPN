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

export type TelegramInvoiceStatus = "cancelled" | "failed" | "paid" | "pending";

export interface TelegramWebApp {
  BackButton?: TelegramBackButton;
  colorScheme: "dark" | "light";
  expand(): void;
  initData: string;
  offEvent(event: "themeChanged", callback: () => void): void;
  onEvent(event: "themeChanged", callback: () => void): void;
  openInvoice?(
    url: string,
    callback?: (status: TelegramInvoiceStatus) => void,
  ): void;
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

export function isTelegramVersionAtLeast(
  currentVersion: string,
  minimumVersion: string,
): boolean {
  const parse = (value: string): number[] | null => {
    if (!/^\d+(?:\.\d+)*$/u.test(value)) {
      return null;
    }

    return value.split(".").map(Number);
  };
  const current = parse(currentVersion);
  const minimum = parse(minimumVersion);

  if (!current || !minimum) {
    return false;
  }

  const length = Math.max(current.length, minimum.length);

  for (let index = 0; index < length; index += 1) {
    const currentPart = current[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;

    if (currentPart !== minimumPart) {
      return currentPart > minimumPart;
    }
  }

  return true;
}

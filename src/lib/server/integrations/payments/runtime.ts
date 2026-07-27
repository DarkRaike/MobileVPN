import type { RuntimeConfig } from "../../config/schema";
import {
  TelegramStarsAdapter,
  UnavailableTelegramStarsAdapter,
  type TelegramStarsPayments,
} from "./telegram-stars";

let paymentAdapter: TelegramStarsPayments | undefined;

export function getTelegramStarsPayments(
  config: RuntimeConfig,
): TelegramStarsPayments {
  paymentAdapter ??=
    config.liveOperationsEnabled && config.telegramBotToken
      ? new TelegramStarsAdapter(config.telegramBotToken)
      : new UnavailableTelegramStarsAdapter();

  return paymentAdapter;
}

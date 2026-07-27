import { describe, expect, it, vi } from "vitest";

import type { Database } from "../../src/lib/server/db/client";
import type {
  StarTransactionPage,
  TelegramStarsPayments,
} from "../../src/lib/server/integrations/payments/telegram-stars";
import {
  parseTelegramPaymentUpdate,
  processTelegramPaymentUpdate,
} from "../../src/lib/server/modules/payments/webhook";

function createPaymentAdapter(): TelegramStarsPayments {
  return {
    answerPreCheckout: vi.fn(async () => undefined),
    createInvoiceLink: vi.fn(async () => "https://t.me/$fixture"),
    getTransactions: vi.fn(async (): Promise<StarTransactionPage> => ({
      nextOffset: null,
      transactions: [],
    })),
    refundPayment: vi.fn(async () => undefined),
  };
}

describe("Telegram payment webhook", () => {
  it("acknowledges unrelated bot updates without touching payment services", async () => {
    const adapter = createPaymentAdapter();
    const update = parseTelegramPaymentUpdate({
      message: {
        chat: { id: 7000000012 },
        date: 1_722_078_000,
        from: { id: 7000000012 },
        text: "/start",
      },
      update_id: 1001,
    });

    const result = await processTelegramPaymentUpdate(
      {} as Database,
      adapter,
      update,
    );

    expect(result).toEqual({ duplicate: false, kind: "ignored" });
    expect(adapter.answerPreCheckout).not.toHaveBeenCalled();
    expect(adapter.refundPayment).not.toHaveBeenCalled();
  });

  it("rejects malformed updates that claim to contain payment data", () => {
    expect(() =>
      parseTelegramPaymentUpdate({
        pre_checkout_query: {
          currency: "XTR",
        },
        update_id: 1002,
      }),
    ).toThrow();
  });
});

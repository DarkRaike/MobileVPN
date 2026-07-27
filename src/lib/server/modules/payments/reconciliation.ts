import type { Database } from "../../db/client";
import type { TelegramStarsPayments } from "../../integrations/payments/telegram-stars";
import {
  confirmSuccessfulPayment,
  findPendingPayments,
} from "../orders/orders";

export interface PaymentReconciliationResult {
  confirmed: number;
  inspected: number;
}

export async function reconcileTelegramStars(
  database: Database,
  paymentAdapter: TelegramStarsPayments,
  maximumPages = 5,
): Promise<PaymentReconciliationResult> {
  const pendingPayments = await findPendingPayments(database);
  const pendingByPayload = new Map(
    pendingPayments.map((payment) => [payment.invoicePayload, payment]),
  );
  let confirmed = 0;
  let inspected = 0;
  let offset: number | null = 0;

  for (
    let pageNumber = 0;
    pageNumber < Math.max(1, Math.min(maximumPages, 10)) && offset !== null;
    pageNumber += 1
  ) {
    const page = await paymentAdapter.getTransactions({ limit: 100, offset });
    offset = page.nextOffset;

    for (const transaction of page.transactions) {
      inspected += 1;

      if (!transaction.invoicePayload || !transaction.telegramUserId) {
        continue;
      }

      const pending = pendingByPayload.get(transaction.invoicePayload);

      if (
        !pending ||
        pending.telegramUserId !== transaction.telegramUserId ||
        pending.currency !== "XTR" ||
        pending.amountStars !== transaction.amountStars
      ) {
        continue;
      }

      const result = await confirmSuccessfulPayment(database, {
        amountStars: transaction.amountStars,
        chargeId: transaction.id,
        currency: "XTR",
        eventId: `reconciliation:${transaction.id}`,
        invoicePayload: transaction.invoicePayload,
        paidAt: transaction.date,
        telegramUserId: transaction.telegramUserId,
      });

      if (!result.duplicate) {
        confirmed += 1;
      }
    }
  }

  return { confirmed, inspected };
}

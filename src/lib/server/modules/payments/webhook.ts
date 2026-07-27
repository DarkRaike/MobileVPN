import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { ApplicationError } from "../../application-error";
import type { Database } from "../../db/client";
import { paymentEvents } from "../../db/schema";
import type { TelegramStarsPayments } from "../../integrations/payments/telegram-stars";
import {
  confirmSuccessfulPayment,
  validatePreCheckout,
} from "../orders/orders";
import { confirmRefundedPayment } from "./refunds";

const telegramUserSchema = z.object({
  id: z.number().int().safe(),
});
const paymentDetailsSchema = z.object({
  currency: z.string(),
  invoice_payload: z.string().min(1).max(128),
  telegram_payment_charge_id: z.string().min(1).max(512),
  total_amount: z.number().int().nonnegative(),
});
const updateSchema = z
  .object({
    message: z
      .object({
        date: z.number().int().nonnegative(),
        from: telegramUserSchema,
        refunded_payment: paymentDetailsSchema.optional(),
        successful_payment: paymentDetailsSchema.optional(),
      })
      .optional(),
    pre_checkout_query: z
      .object({
        currency: z.string(),
        from: telegramUserSchema,
        id: z.string().min(1).max(512),
        invoice_payload: z.string().min(1).max(128),
        total_amount: z.number().int().nonnegative(),
      })
      .optional(),
    update_id: z.number().int().safe().nonnegative(),
  })
  .superRefine((update, context) => {
    if (
      !update.pre_checkout_query &&
      !update.message?.successful_payment &&
      !update.message?.refunded_payment
    ) {
      context.addIssue({
        code: "custom",
        message: "Unsupported Telegram update",
      });
    }
  });

export type TelegramPaymentUpdate = z.infer<typeof updateSchema>;

export function parseTelegramPaymentUpdate(
  value: unknown,
): TelegramPaymentUpdate {
  return updateSchema.parse(value);
}

async function recordProcessedEvent(
  database: Database,
  eventId: string,
  eventType: string,
  now: Date,
): Promise<void> {
  await database
    .insert(paymentEvents)
    .values({
      createdAt: now,
      eventType,
      externalEventId: eventId,
      processedAt: now,
      provider: "telegram_stars",
      receivedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        processedAt: now,
        processingErrorCode: null,
        updatedAt: now,
      },
      target: [paymentEvents.provider, paymentEvents.externalEventId],
    });
}

async function recordEventFailure(
  database: Database,
  eventId: string,
  eventType: string,
  errorCode: string,
  now: Date,
): Promise<void> {
  await database
    .insert(paymentEvents)
    .values({
      createdAt: now,
      eventType,
      externalEventId: eventId,
      processingErrorCode: errorCode,
      provider: "telegram_stars",
      receivedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: { processingErrorCode: errorCode, updatedAt: now },
      target: [paymentEvents.provider, paymentEvents.externalEventId],
    });
}

export async function processTelegramPaymentUpdate(
  database: Database,
  paymentAdapter: TelegramStarsPayments,
  update: TelegramPaymentUpdate,
  now = new Date(),
): Promise<{
  duplicate: boolean;
  kind: "pre_checkout" | "refunded_payment" | "successful_payment";
}> {
  const eventId = String(update.update_id);
  const preCheckout = update.pre_checkout_query;

  if (preCheckout) {
    try {
      await validatePreCheckout(
        database,
        {
          amountStars: preCheckout.total_amount,
          currency: preCheckout.currency,
          invoicePayload: preCheckout.invoice_payload,
          telegramUserId: String(preCheckout.from.id),
        },
        now,
      );
      await paymentAdapter.answerPreCheckout({
        ok: true,
        queryId: preCheckout.id,
      });
      await recordProcessedEvent(database, eventId, "pre_checkout", now);
      return { duplicate: false, kind: "pre_checkout" };
    } catch (error) {
      if (
        error instanceof ApplicationError &&
        (error.code === "PRE_CHECKOUT_REJECTED" ||
          error.code === "SUBSCRIPTION_HORIZON_EXCEEDED")
      ) {
        await paymentAdapter.answerPreCheckout({
          errorMessage:
            "Параметры заказа изменились. Вернитесь в приложение и создайте заказ заново.",
          ok: false,
          queryId: preCheckout.id,
        });
        await recordProcessedEvent(
          database,
          eventId,
          "pre_checkout_rejected",
          now,
        );
        return { duplicate: false, kind: "pre_checkout" };
      }

      await recordEventFailure(
        database,
        eventId,
        "pre_checkout",
        error instanceof ApplicationError
          ? error.code
          : "PRE_CHECKOUT_PROCESSING_FAILED",
        now,
      );
      throw error;
    }
  }

  const message = update.message;
  const refundedPayment = message?.refunded_payment;

  if (message && refundedPayment) {
    const result = await confirmRefundedPayment(database, {
      amountStars: refundedPayment.total_amount,
      chargeId: refundedPayment.telegram_payment_charge_id,
      currency: refundedPayment.currency,
      eventId,
      invoicePayload: refundedPayment.invoice_payload,
      refundedAt: new Date(message.date * 1_000),
      telegramUserId: String(message.from.id),
    });

    return {
      duplicate: result.duplicate,
      kind: "refunded_payment",
    };
  }

  const successfulPayment = message?.successful_payment;

  if (!message || !successfulPayment) {
    throw new ApplicationError(
      "TELEGRAM_UPDATE_UNSUPPORTED",
      "Неподдерживаемое событие Telegram.",
    );
  }

  const result = await confirmSuccessfulPayment(database, {
    amountStars: successfulPayment.total_amount,
    chargeId: successfulPayment.telegram_payment_charge_id,
    currency: successfulPayment.currency,
    eventId,
    invoicePayload: successfulPayment.invoice_payload,
    paidAt: new Date(message.date * 1_000),
    telegramUserId: String(message.from.id),
  });

  return {
    duplicate: result.duplicate,
    kind: "successful_payment",
  };
}

export async function wasPaymentEventProcessed(
  database: Database,
  eventId: string,
): Promise<boolean> {
  const records = await database
    .select({ processedAt: paymentEvents.processedAt })
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.provider, "telegram_stars"),
        eq(paymentEvents.externalEventId, eventId),
      ),
    )
    .limit(1);

  return Boolean(records[0]?.processedAt);
}

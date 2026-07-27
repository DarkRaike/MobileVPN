import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { ApplicationError } from "../../application-error";
import type { Database } from "../../db/client";
import {
  orderProvisioning,
  orders,
  paymentEvents,
  payments,
  refunds,
  subscriptions,
  users,
} from "../../db/schema";
import {
  assertOrderTransition,
  assertPaymentTransition,
} from "../../domain/order-state";
import type { TelegramStarsPayments } from "../../integrations/payments/telegram-stars";

export interface RefundedPaymentInput {
  amountStars: number;
  chargeId: string;
  currency: string;
  eventId: string;
  invoicePayload: string;
  refundedAt: Date;
  telegramUserId: string;
}

export async function confirmRefundedPayment(
  database: Database,
  input: RefundedPaymentInput,
) {
  return database.transaction(async (transaction) => {
    const insertedEvents = await transaction
      .insert(paymentEvents)
      .values({
        createdAt: input.refundedAt,
        eventType: "refunded_payment",
        externalEventId: input.eventId,
        provider: "telegram_stars",
        receivedAt: input.refundedAt,
        updatedAt: input.refundedAt,
      })
      .onConflictDoNothing()
      .returning({ eventId: paymentEvents.externalEventId });

    if (insertedEvents.length === 0) {
      return { duplicate: true, orderId: null };
    }

    const records = await transaction
      .select({
        amountStars: payments.amountStars,
        appliedDurationDays: orderProvisioning.appliedDurationDays,
        chargeId: payments.telegramPaymentChargeId,
        currency: payments.currency,
        invoicePayload: payments.invoicePayload,
        orderId: orders.id,
        orderStatus: orders.status,
        paymentId: payments.id,
        paymentStatus: payments.status,
        subscriptionExpiresAt: subscriptions.expiresAt,
        subscriptionId: subscriptions.id,
        subscriptionStartsAt: subscriptions.startsAt,
        telegramUserId: users.telegramUserId,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .innerJoin(users, eq(users.id, orders.userId))
      .leftJoin(orderProvisioning, eq(orderProvisioning.orderId, orders.id))
      .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
      .where(eq(payments.invoicePayload, input.invoicePayload))
      .limit(1);
    const payment = records[0];

    if (
      !payment ||
      payment.telegramUserId !== input.telegramUserId ||
      payment.chargeId !== input.chargeId ||
      payment.currency !== "XTR" ||
      input.currency !== "XTR" ||
      payment.amountStars !== input.amountStars
    ) {
      throw new ApplicationError(
        "REFUND_CONFIRMATION_MISMATCH",
        "Возврат не соответствует платежу.",
      );
    }

    if (payment.paymentStatus === "refunded") {
      await transaction
        .update(paymentEvents)
        .set({ processedAt: input.refundedAt, updatedAt: input.refundedAt })
        .where(
          and(
            eq(paymentEvents.provider, "telegram_stars"),
            eq(paymentEvents.externalEventId, input.eventId),
          ),
        );
      return { duplicate: true, orderId: payment.orderId };
    }

    assertPaymentTransition(payment.paymentStatus, "refunded");
    assertOrderTransition(payment.orderStatus, "refunded");

    await transaction
      .update(payments)
      .set({
        refundedAt: input.refundedAt,
        status: "refunded",
        updatedAt: input.refundedAt,
      })
      .where(eq(payments.id, payment.paymentId));
    await transaction
      .update(orders)
      .set({ status: "refunded", updatedAt: input.refundedAt })
      .where(eq(orders.id, payment.orderId));
    const refundRecords = await transaction
      .select({ id: refunds.id })
      .from(refunds)
      .where(eq(refunds.paymentId, payment.paymentId))
      .orderBy(desc(refunds.requestedAt))
      .limit(1);
    const existingRefund = refundRecords[0];
    const refundValues = {
      confirmedAt: input.refundedAt,
      failedAt: null,
      providerEvidenceSafe: JSON.stringify({
        eventId: input.eventId,
        source: "telegram_refunded_payment",
      }),
      status: "refunded" as const,
      updatedAt: input.refundedAt,
    };

    if (existingRefund) {
      await transaction
        .update(refunds)
        .set(refundValues)
        .where(eq(refunds.id, existingRefund.id));
    } else {
      await transaction.insert(refunds).values({
        amountStars: payment.amountStars,
        confirmedAt: input.refundedAt,
        createdAt: input.refundedAt,
        currency: "XTR",
        id: randomUUID(),
        paymentId: payment.paymentId,
        providerEvidenceSafe: refundValues.providerEvidenceSafe,
        reasonCode: "provider_refund",
        requestedAt: input.refundedAt,
        status: "refunded",
        updatedAt: input.refundedAt,
      });
    }

    if (
      payment.subscriptionId &&
      payment.subscriptionExpiresAt &&
      payment.subscriptionStartsAt &&
      payment.appliedDurationDays
    ) {
      const durationMilliseconds =
        payment.appliedDurationDays * 24 * 60 * 60 * 1_000;
      const minimumExpiry = Math.max(
        input.refundedAt.getTime() + 1_000,
        payment.subscriptionStartsAt.getTime() + 1_000,
      );
      const adjustedExpiry = new Date(
        Math.max(
          minimumExpiry,
          payment.subscriptionExpiresAt.getTime() - durationMilliseconds,
        ),
      );

      await transaction
        .update(subscriptions)
        .set({
          expiresAt: adjustedExpiry,
          status:
            adjustedExpiry.getTime() > input.refundedAt.getTime()
              ? "active"
              : "expired",
          updatedAt: input.refundedAt,
          version: sql`${subscriptions.version} + 1`,
        })
        .where(eq(subscriptions.id, payment.subscriptionId));
    }

    await transaction
      .update(paymentEvents)
      .set({ processedAt: input.refundedAt, updatedAt: input.refundedAt })
      .where(
        and(
          eq(paymentEvents.provider, "telegram_stars"),
          eq(paymentEvents.externalEventId, input.eventId),
        ),
      );

    return { duplicate: false, orderId: payment.orderId };
  });
}

export async function requestFullRefund(
  database: Database,
  paymentAdapter: TelegramStarsPayments,
  paymentId: string,
  reasonCode: string,
  now = new Date(),
) {
  const prepared = await database.transaction(async (transaction) => {
    const records = await transaction
      .select({
        amountStars: payments.amountStars,
        chargeId: payments.telegramPaymentChargeId,
        currency: payments.currency,
        invoicePayload: payments.invoicePayload,
        paymentStatus: payments.status,
        telegramUserId: users.telegramUserId,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .innerJoin(users, eq(users.id, orders.userId))
      .where(eq(payments.id, paymentId))
      .limit(1);
    const payment = records[0];

    if (
      !payment ||
      payment.paymentStatus !== "succeeded" ||
      !payment.chargeId
    ) {
      if (payment?.paymentStatus === "refunded") {
        return null;
      }

      throw new ApplicationError(
        "REFUND_NOT_ALLOWED",
        "Возврат для этого платежа недоступен.",
      );
    }

    const existingRefundRecords = await transaction
      .select({ id: refunds.id, status: refunds.status })
      .from(refunds)
      .where(eq(refunds.paymentId, paymentId))
      .orderBy(desc(refunds.requestedAt))
      .limit(1);
    const existingRefund = existingRefundRecords[0];

    if (
      existingRefund &&
      ["refund_requested", "refund_pending", "refunded"].includes(
        existingRefund.status,
      )
    ) {
      return null;
    }

    const refundId = existingRefund?.id ?? randomUUID();
    const refundValues = {
      amountStars: payment.amountStars,
      currency: "XTR",
      failedAt: null,
      paymentId,
      providerEvidenceSafe: null,
      reasonCode,
      requestedAt: now,
      status: "refund_pending" as const,
      updatedAt: now,
    };

    if (existingRefund) {
      await transaction
        .update(refunds)
        .set(refundValues)
        .where(eq(refunds.id, refundId));
    } else {
      await transaction.insert(refunds).values({
        ...refundValues,
        createdAt: now,
        id: refundId,
      });
    }

    return {
      amountStars: payment.amountStars,
      chargeId: payment.chargeId,
      currency: payment.currency,
      invoicePayload: payment.invoicePayload,
      refundId,
      telegramUserId: payment.telegramUserId,
    };
  });

  if (!prepared) {
    return { duplicate: true };
  }

  try {
    await paymentAdapter.refundPayment({
      telegramPaymentChargeId: prepared.chargeId,
      telegramUserId: prepared.telegramUserId,
    });
    await confirmRefundedPayment(database, {
      amountStars: prepared.amountStars,
      chargeId: prepared.chargeId,
      currency: prepared.currency,
      eventId: `refund_request:${prepared.refundId}`,
      invoicePayload: prepared.invoicePayload,
      refundedAt: now,
      telegramUserId: prepared.telegramUserId,
    });

    return { duplicate: false };
  } catch (error) {
    await database
      .update(refunds)
      .set({
        failedAt: now,
        providerEvidenceSafe: JSON.stringify({
          errorCode:
            error instanceof ApplicationError
              ? error.code
              : "REFUND_PROVIDER_FAILED",
        }),
        status: "refund_failed",
        updatedAt: now,
      })
      .where(eq(refunds.id, prepared.refundId));
    throw error;
  }
}

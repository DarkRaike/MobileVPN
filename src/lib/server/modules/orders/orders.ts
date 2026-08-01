import { randomUUID } from "node:crypto";

import { and, asc, count, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { ApplicationError } from "../../application-error";
import type { Database } from "../../db/client";
import {
  orderProvisioning,
  orders,
  paymentEvents,
  payments,
  plans,
  promoCodePlans,
  promoCodes,
  subscriptions,
  users,
} from "../../db/schema";
import {
  assertOrderTransition,
  assertPaymentTransition,
} from "../../domain/order-state";
import {
  calculateSubscriptionExpiry,
  canExtendSubscription,
} from "../../domain/subscriptions";
import {
  assertPromoAvailable,
  calculateDiscountStars,
  normalizePromoCode,
} from "../../domain/promo-codes";
import {
  createStarsInvoicePayload,
  type TelegramStarsPayments,
} from "../../integrations/payments/telegram-stars";

const successfulOrderStatuses = [
  "paid",
  "provisioning",
  "active",
  "provisioning_failed",
  "refunded",
] as const;

export interface CreateOrderInput {
  idempotencyKey: string;
  planId: string;
  promoCode?: string;
}

export interface SuccessfulPaymentInput {
  amountStars: number;
  chargeId: string;
  currency: string;
  eventId: string;
  invoicePayload: string;
  paidAt: Date;
  telegramUserId: string;
}

export interface PreCheckoutInput {
  amountStars: number;
  currency: string;
  invoicePayload: string;
  telegramUserId: string;
}

interface PreparedOrder {
  amountStars: number;
  description: string;
  label: string;
  orderId: string;
  paymentAttemptId: string;
  title: string;
}

async function prepareOrder(
  database: Database,
  userId: string,
  input: CreateOrderInput,
  now: Date,
): Promise<PreparedOrder> {
  return database.transaction(async (transaction) => {
    const existingRecords = await transaction
      .select({
        amountStars: payments.amountStars,
        description: orders.planDescriptionSnapshot,
        orderId: orders.id,
        paymentAttemptId: payments.id,
        planId: orders.planId,
        planName: orders.planNameSnapshot,
        status: orders.status,
        userId: orders.userId,
      })
      .from(orders)
      .innerJoin(payments, eq(payments.orderId, orders.id))
      .where(eq(orders.idempotencyKey, input.idempotencyKey))
      .limit(1);
    const existing = existingRecords[0];

    if (existing) {
      if (
        existing.userId !== userId ||
        existing.planId !== input.planId ||
        existing.status !== "pending_payment"
      ) {
        throw new ApplicationError(
          "ORDER_IDEMPOTENCY_CONFLICT",
          "Не удалось повторить создание заказа.",
        );
      }

      return {
        amountStars: existing.amountStars,
        description:
          existing.description ?? `VPN-доступ на тарифе ${existing.planName}.`,
        label: existing.planName,
        orderId: existing.orderId,
        paymentAttemptId: existing.paymentAttemptId,
        title: `VPN · ${existing.planName}`,
      };
    }

    const planRecords = await transaction
      .select()
      .from(plans)
      .where(and(eq(plans.id, input.planId), eq(plans.isActive, true)))
      .limit(1);
    const plan = planRecords[0];

    if (!plan) {
      throw new ApplicationError(
        "PLAN_NOT_AVAILABLE",
        "Тариф больше недоступен.",
      );
    }

    let promoCode: typeof promoCodes.$inferSelect | null = null;
    let discountStars = 0;

    if (input.promoCode) {
      const normalizedCode = normalizePromoCode(input.promoCode);
      const promoRecords = await transaction
        .select()
        .from(promoCodes)
        .where(eq(promoCodes.codeNormalized, normalizedCode))
        .limit(1);
      promoCode = promoRecords[0] ?? null;

      if (!promoCode) {
        throw new ApplicationError("PROMO_NOT_FOUND", "Промокод не найден.");
      }

      const [totalUsage, userUsage, planRelations] = await Promise.all([
        transaction
          .select({ value: count() })
          .from(orders)
          .where(
            and(
              eq(orders.promoCodeId, promoCode.id),
              inArray(orders.status, successfulOrderStatuses),
            ),
          ),
        transaction
          .select({ value: count() })
          .from(orders)
          .where(
            and(
              eq(orders.promoCodeId, promoCode.id),
              eq(orders.userId, userId),
              inArray(orders.status, successfulOrderStatuses),
            ),
          ),
        transaction
          .select({ planId: promoCodePlans.planId })
          .from(promoCodePlans)
          .where(eq(promoCodePlans.promoCodeId, promoCode.id)),
      ]);

      assertPromoAvailable(
        promoCode,
        {
          total: totalUsage[0]?.value ?? 0,
          user: userUsage[0]?.value ?? 0,
        },
        now,
      );

      if (
        planRelations.length > 0 &&
        !planRelations.some((relation) => relation.planId === plan.id)
      ) {
        throw new ApplicationError(
          "PROMO_NOT_APPLICABLE",
          "Промокод не подходит к этому тарифу.",
        );
      }

      if (promoCode.currency && promoCode.currency !== plan.currency) {
        throw new ApplicationError(
          "PROMO_CURRENCY_MISMATCH",
          "Промокод не подходит к валюте тарифа.",
        );
      }

      discountStars = calculateDiscountStars(
        plan.priceStars,
        promoCode.discountType,
        promoCode.discountValue,
      );
    }

    const totalStars = plan.priceStars - discountStars;

    if (totalStars <= 0) {
      throw new ApplicationError(
        "ORDER_ZERO_TOTAL_UNSUPPORTED",
        "Для этого заказа не требуется платёж. Обратитесь в поддержку.",
      );
    }

    const orderId = randomUUID();
    const paymentAttemptId = randomUUID();

    await transaction.insert(orders).values({
      currency: "XTR",
      discountStars,
      discountTypeSnapshot: promoCode?.discountType ?? null,
      discountValueSnapshot: promoCode?.discountValue ?? null,
      durationDaysSnapshot: plan.durationDays,
      id: orderId,
      idempotencyKey: input.idempotencyKey,
      planDescriptionSnapshot: plan.description,
      planId: plan.id,
      planNameSnapshot: plan.name,
      priceStarsSnapshot: plan.priceStars,
      promoCodeId: promoCode?.id ?? null,
      promoCodeSnapshot: promoCode?.codeNormalized ?? null,
      status: "pending_payment",
      subtotalStars: plan.priceStars,
      totalStars,
      userId,
      createdAt: now,
      updatedAt: now,
    });
    await transaction.insert(payments).values({
      amountStars: totalStars,
      createdAt: now,
      currency: "XTR",
      id: paymentAttemptId,
      invoicePayload: createStarsInvoicePayload(paymentAttemptId),
      orderId,
      provider: "telegram_stars",
      status: "pending",
      updatedAt: now,
    });

    return {
      amountStars: totalStars,
      description: plan.description ?? `VPN-доступ на тарифе ${plan.name}.`,
      label: plan.name,
      orderId,
      paymentAttemptId,
      title: `VPN · ${plan.name}`,
    };
  });
}

export async function createOrderInvoice(
  database: Database,
  paymentAdapter: TelegramStarsPayments,
  userId: string,
  input: CreateOrderInput,
  now = new Date(),
) {
  const prepared = await prepareOrder(database, userId, input, now);
  const invoiceUrl = await paymentAdapter.createInvoiceLink({
    amountStars: prepared.amountStars,
    description: prepared.description,
    label: prepared.label,
    paymentAttemptId: prepared.paymentAttemptId,
    title: prepared.title,
  });

  return {
    amountStars: prepared.amountStars,
    invoiceUrl,
    orderId: prepared.orderId,
  };
}

export async function validatePreCheckout(
  database: Database,
  input: PreCheckoutInput,
  now = new Date(),
): Promise<void> {
  const records = await database
    .select({
      amountStars: payments.amountStars,
      currency: payments.currency,
      durationDays: orders.durationDaysSnapshot,
      invoicePayload: payments.invoicePayload,
      orderStatus: orders.status,
      paymentStatus: payments.status,
      subscriptionExpiresAt: subscriptions.expiresAt,
      telegramUserId: users.telegramUserId,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(users, eq(users.id, orders.userId))
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .where(eq(payments.invoicePayload, input.invoicePayload))
    .limit(1);
  const payment = records[0];

  if (
    !payment ||
    payment.paymentStatus !== "pending" ||
    payment.orderStatus !== "pending_payment" ||
    payment.telegramUserId !== input.telegramUserId ||
    payment.invoicePayload !== input.invoicePayload ||
    payment.currency !== "XTR" ||
    input.currency !== "XTR" ||
    payment.amountStars !== input.amountStars ||
    !canExtendSubscription(
      payment.subscriptionExpiresAt,
      payment.durationDays,
      now,
    )
  ) {
    throw new ApplicationError(
      "PRE_CHECKOUT_REJECTED",
      "Параметры платежа изменились. Создайте заказ заново.",
    );
  }
}

export async function confirmSuccessfulPayment(
  database: Database,
  input: SuccessfulPaymentInput,
) {
  return database.transaction(async (transaction) => {
    const insertedEvents = await transaction
      .insert(paymentEvents)
      .values({
        createdAt: input.paidAt,
        eventType: "successful_payment",
        externalEventId: input.eventId,
        provider: "telegram_stars",
        receivedAt: input.paidAt,
        updatedAt: input.paidAt,
      })
      .onConflictDoNothing()
      .returning({ eventId: paymentEvents.externalEventId });

    if (insertedEvents.length === 0) {
      return { duplicate: true, orderId: null };
    }

    const records = await transaction
      .select({
        amountStars: payments.amountStars,
        chargeId: payments.telegramPaymentChargeId,
        currency: payments.currency,
        durationDays: orders.durationDaysSnapshot,
        invoicePayload: payments.invoicePayload,
        orderId: orders.id,
        orderStatus: orders.status,
        paymentId: payments.id,
        paymentStatus: payments.status,
        telegramUserId: users.telegramUserId,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .innerJoin(users, eq(users.id, orders.userId))
      .where(eq(payments.invoicePayload, input.invoicePayload))
      .limit(1);
    const payment = records[0];

    if (
      !payment ||
      payment.telegramUserId !== input.telegramUserId ||
      payment.currency !== "XTR" ||
      input.currency !== "XTR" ||
      payment.amountStars !== input.amountStars ||
      payment.invoicePayload !== input.invoicePayload ||
      !input.chargeId ||
      input.chargeId.length > 512
    ) {
      throw new ApplicationError(
        "PAYMENT_CONFIRMATION_MISMATCH",
        "Платёж не соответствует заказу.",
      );
    }

    if (payment.paymentStatus === "succeeded") {
      if (payment.chargeId !== input.chargeId) {
        throw new ApplicationError(
          "PAYMENT_CHARGE_MISMATCH",
          "Платёж уже подтверждён другой транзакцией.",
        );
      }

      await transaction
        .update(paymentEvents)
        .set({ processedAt: input.paidAt, updatedAt: input.paidAt })
        .where(
          and(
            eq(paymentEvents.provider, "telegram_stars"),
            eq(paymentEvents.externalEventId, input.eventId),
          ),
        );

      return { duplicate: true, orderId: payment.orderId };
    }

    assertPaymentTransition(payment.paymentStatus, "succeeded");
    assertOrderTransition(payment.orderStatus, "paid");

    const targetExpiresAt = calculateSubscriptionExpiry({
      durationDays: payment.durationDays,
      paidAt: input.paidAt,
    });

    await transaction
      .update(payments)
      .set({
        paidAt: input.paidAt,
        providerPayloadSafe: JSON.stringify({
          eventId: input.eventId,
          source: "telegram_successful_payment",
        }),
        status: "succeeded",
        telegramPaymentChargeId: input.chargeId,
        updatedAt: input.paidAt,
      })
      .where(eq(payments.id, payment.paymentId));
    await transaction
      .update(orders)
      .set({
        provisioningErrorCode: null,
        provisioningStatus: "pending",
        status: "paid",
        updatedAt: input.paidAt,
      })
      .where(eq(orders.id, payment.orderId));
    await transaction
      .insert(orderProvisioning)
      .values({
        appliedDurationDays: payment.durationDays,
        createdAt: input.paidAt,
        orderId: payment.orderId,
        state: "pending",
        targetExpiresAt,
        updatedAt: input.paidAt,
      })
      .onConflictDoNothing();
    await transaction
      .update(paymentEvents)
      .set({ processedAt: input.paidAt, updatedAt: input.paidAt })
      .where(
        and(
          eq(paymentEvents.provider, "telegram_stars"),
          eq(paymentEvents.externalEventId, input.eventId),
        ),
      );

    return { duplicate: false, orderId: payment.orderId };
  });
}

export async function listPurchaseHistory(database: Database, userId: string) {
  return database
    .select({
      createdAt: orders.createdAt,
      currency: orders.currency,
      discountStars: orders.discountStars,
      id: orders.id,
      paymentStatus: payments.status,
      planName: orders.planNameSnapshot,
      provisioningStatus: orders.provisioningStatus,
      status: orders.status,
      subtotalStars: orders.subtotalStars,
      totalStars: orders.totalStars,
    })
    .from(orders)
    .leftJoin(payments, eq(payments.orderId, orders.id))
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt), desc(orders.id));
}

export async function listOrdersForAdmin(database: Database) {
  return database
    .select({
      chargeId: payments.telegramPaymentChargeId,
      createdAt: orders.createdAt,
      currency: orders.currency,
      id: orders.id,
      nextAttemptAt: orderProvisioning.nextAttemptAt,
      paymentId: payments.id,
      paymentStatus: payments.status,
      planName: orders.planNameSnapshot,
      provisioningAttempts: orders.provisioningAttempts,
      provisioningErrorCode: orders.provisioningErrorCode,
      provisioningStatus: orders.provisioningStatus,
      source: orders.source,
      status: orders.status,
      telegramUserId: users.telegramUserId,
      totalStars: orders.totalStars,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .leftJoin(payments, eq(payments.orderId, orders.id))
    .leftJoin(orderProvisioning, eq(orderProvisioning.orderId, orders.id))
    .orderBy(desc(orders.createdAt), desc(orders.id));
}

export async function findPendingPayments(database: Database, limit = 100) {
  return database
    .select({
      amountStars: payments.amountStars,
      currency: payments.currency,
      invoicePayload: payments.invoicePayload,
      telegramUserId: users.telegramUserId,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(users, eq(users.id, orders.userId))
    .where(
      and(
        eq(payments.status, "pending"),
        eq(orders.status, "pending_payment"),
        isNotNull(payments.invoicePayload),
      ),
    )
    .orderBy(asc(payments.createdAt))
    .limit(limit);
}

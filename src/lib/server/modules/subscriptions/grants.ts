import { randomUUID } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import { ApplicationError } from "../../application-error";
import type { Database } from "../../db/client";
import {
  adminAuditLog,
  orderProvisioning,
  orders,
  subscriptions,
  users,
} from "../../db/schema";
import { calculateSubscriptionExpiry } from "../../domain/subscriptions";
import { createAuditRecord } from "../admin/audit";

export const GRANT_PLAN_NAME = "Доступ от администратора";

export interface GrantSubscriptionInput {
  adminUserId: string;
  durationDays: number;
  targetTelegramUserId: string;
}

export interface GrantSubscriptionResult {
  orderId: string;
  targetExpiresAt: Date;
  userId: string;
}

/**
 * Issues VPN access without a payment. The grant reuses the regular
 * provisioning pipeline by creating an order that is already `paid`, so
 * idempotency, retries and reconciliation behave exactly as for a purchase.
 * No `payments` row is written: a grant is not a transaction.
 */
export async function grantSubscription(
  database: Database,
  input: GrantSubscriptionInput,
  now = new Date(),
): Promise<GrantSubscriptionResult> {
  return database.transaction(async (transaction) => {
    const userRecords = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramUserId, input.targetTelegramUserId))
      .limit(1);
    const user = userRecords[0];

    if (!user) {
      throw new ApplicationError(
        "GRANT_USER_NOT_FOUND",
        "Пользователь ещё не открывал приложение из Telegram.",
      );
    }

    const subscriptionRecords = await transaction
      .select({ expiresAt: subscriptions.expiresAt })
      .from(subscriptions)
      .where(eq(subscriptions.userId, user.id))
      .limit(1);
    const targetExpiresAt = calculateSubscriptionExpiry({
      durationDays: input.durationDays,
      localExpiresAt: subscriptionRecords[0]?.expiresAt ?? null,
      paidAt: now,
    });
    const orderId = randomUUID();

    await transaction.insert(orders).values({
      createdAt: now,
      currency: "XTR",
      discountStars: 0,
      durationDaysSnapshot: input.durationDays,
      id: orderId,
      idempotencyKey: `grant:${orderId}`,
      planId: null,
      planNameSnapshot: GRANT_PLAN_NAME,
      priceStarsSnapshot: 0,
      provisioningStatus: "pending",
      source: "admin_grant",
      status: "paid",
      subtotalStars: 0,
      totalStars: 0,
      updatedAt: now,
      userId: user.id,
    });
    await transaction.insert(orderProvisioning).values({
      appliedDurationDays: input.durationDays,
      createdAt: now,
      orderId,
      state: "pending",
      targetExpiresAt,
      updatedAt: now,
    });
    await transaction.insert(adminAuditLog).values(
      createAuditRecord({
        action: "subscription.grant",
        adminUserId: input.adminUserId,
        after: {
          durationDays: input.durationDays,
          targetExpiresAt: targetExpiresAt.toISOString(),
        },
        entityId: orderId,
        entityType: "order",
        now,
      }),
    );

    return { orderId, targetExpiresAt, userId: user.id };
  });
}

export async function listGrantsForAdmin(database: Database, limit = 50) {
  return database
    .select({
      createdAt: orders.createdAt,
      id: orders.id,
      planName: orders.planNameSnapshot,
      provisioningErrorCode: orders.provisioningErrorCode,
      provisioningStatus: orders.provisioningStatus,
      telegramUserId: users.telegramUserId,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(eq(orders.source, "admin_grant"))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit);
}

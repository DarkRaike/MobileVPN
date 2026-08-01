import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { ApplicationError } from "../../application-error";
import type { Database } from "../../db/client";
import {
  adminAuditLog,
  orderProvisioning,
  orders,
  payments,
  subscriptions,
} from "../../db/schema";
import { calculateSubscriptionExpiry } from "../../domain/subscriptions";
import type { Marzban, MarzbanUser } from "../../integrations/marzban/marzban";
import { logEvent } from "../../observability/logger";
import { encryptSubscriptionUrl } from "../../security/subscription-url";
import { createAuditRecord } from "../admin/audit";

const LOCK_TIMEOUT_MILLISECONDS = 5 * 60 * 1_000;
const RETRY_DELAYS_SECONDS = [60, 300, 900, 3_600, 21_600] as const;

interface ProvisioningClaim {
  attemptsBeforeClaim: number;
  durationDays: number;
  localExpiresAt: Date | null;
  localStartsAt: Date | null;
  marzbanUsername: string;
  orderId: string;
  paidAt: Date;
  targetExpiresAt: Date;
  userId: string;
}

export interface ProvisioningResult {
  errorCode?: string;
  orderId: string;
  status: "applied" | "failed" | "skipped";
}

export interface SubscriptionReconciliationResult {
  failed: number;
  inspected: number;
  synchronized: number;
}

export function createMarzbanUsername(userId: string): string {
  const compactId = userId.replaceAll("-", "").toLowerCase();

  if (!/^[0-9a-f]{32}$/u.test(compactId)) {
    throw new ApplicationError(
      "USER_ID_INVALID",
      "Некорректный идентификатор пользователя.",
    );
  }

  return `tg_${compactId.slice(0, 24)}`;
}

function retryAt(attempt: number, now: Date): Date {
  const delaySeconds =
    RETRY_DELAYS_SECONDS[
      Math.min(Math.max(attempt - 1, 0), RETRY_DELAYS_SECONDS.length - 1)
    ] ?? 21_600;

  return new Date(now.getTime() + delaySeconds * 1_000);
}

function normalizeErrorCode(error: unknown): string {
  if (
    error instanceof ApplicationError &&
    /^(LIVE_OPERATIONS_DISABLED|MARZBAN_|SUBSCRIPTION_|USER_ID_)/u.test(
      error.code,
    )
  ) {
    return error.code;
  }

  return "PROVISIONING_FAILED";
}

async function claimOrder(
  database: Database,
  orderId: string,
  now: Date,
): Promise<ProvisioningClaim | null> {
  return database.transaction(async (transaction) => {
    const staleBefore = new Date(now.getTime() - LOCK_TIMEOUT_MILLISECONDS);
    const records = await transaction
      .select({
        attempts: orders.provisioningAttempts,
        createdAt: orders.createdAt,
        durationDays: orders.durationDaysSnapshot,
        localExpiresAt: subscriptions.expiresAt,
        localMarzbanUsername: subscriptions.marzbanUsername,
        localStartsAt: subscriptions.startsAt,
        lockedAt: orderProvisioning.lockedAt,
        orderId: orders.id,
        orderStatus: orders.status,
        paidAt: payments.paidAt,
        provisioningState: orderProvisioning.state,
        provisioningStatus: orders.provisioningStatus,
        source: orders.source,
        targetExpiresAt: orderProvisioning.targetExpiresAt,
        userId: orders.userId,
      })
      .from(orders)
      // Administrator grants have no payment row, so the join stays optional.
      .leftJoin(payments, eq(payments.orderId, orders.id))
      .innerJoin(orderProvisioning, eq(orderProvisioning.orderId, orders.id))
      .leftJoin(subscriptions, eq(subscriptions.userId, orders.userId))
      .where(eq(orders.id, orderId))
      .limit(1);
    const order = records[0];
    // A grant is effective from the moment the administrator issued it.
    const effectivePaidAt =
      order?.source === "admin_grant"
        ? (order.paidAt ?? order.createdAt)
        : order?.paidAt;

    if (
      !order ||
      !effectivePaidAt ||
      order.provisioningState === "applied" ||
      order.orderStatus === "active" ||
      !["paid", "provisioning", "provisioning_failed"].includes(
        order.orderStatus,
      )
    ) {
      return null;
    }

    const activeUserClaims = await transaction
      .select({ orderId: orders.id })
      .from(orders)
      .innerJoin(orderProvisioning, eq(orderProvisioning.orderId, orders.id))
      .where(
        and(
          eq(orders.userId, order.userId),
          ne(orders.id, orderId),
          eq(orderProvisioning.state, "processing"),
          gt(orderProvisioning.lockedAt, staleBefore),
        ),
      )
      .limit(1);

    if (activeUserClaims.length > 0) {
      return null;
    }

    const claimed = await transaction
      .update(orderProvisioning)
      .set({
        lastErrorCode: null,
        lockedAt: now,
        nextAttemptAt: null,
        state: "processing",
        updatedAt: now,
      })
      .where(
        and(
          eq(orderProvisioning.orderId, orderId),
          or(
            inArray(orderProvisioning.state, ["pending", "failed"]),
            and(
              eq(orderProvisioning.state, "processing"),
              or(
                isNull(orderProvisioning.lockedAt),
                lte(orderProvisioning.lockedAt, staleBefore),
              ),
            ),
          ),
        ),
      )
      .returning({ orderId: orderProvisioning.orderId });

    if (claimed.length === 0) {
      return null;
    }

    await transaction
      .update(orders)
      .set({
        provisioningAttempts: sql`${orders.provisioningAttempts} + 1`,
        provisioningErrorCode: null,
        provisioningStatus: "processing",
        status: "provisioning",
        updatedAt: now,
      })
      .where(eq(orders.id, orderId));

    return {
      attemptsBeforeClaim: order.attempts,
      durationDays: order.durationDays,
      localExpiresAt: order.localExpiresAt,
      localStartsAt: order.localStartsAt,
      marzbanUsername:
        order.localMarzbanUsername ?? createMarzbanUsername(order.userId),
      orderId,
      paidAt: effectivePaidAt,
      targetExpiresAt: order.targetExpiresAt,
      userId: order.userId,
    };
  });
}

function isProvisionedAtTarget(
  user: MarzbanUser,
  targetExpiresAt: Date,
): boolean {
  return (
    user.status === "active" &&
    user.expiresAt !== null &&
    user.expiresAt.getTime() >= targetExpiresAt.getTime()
  );
}

async function markFailed(
  database: Database,
  orderId: string,
  errorCode: string,
  now: Date,
): Promise<void> {
  await database.transaction(async (transaction) => {
    const records = await transaction
      .select({ attempts: orders.provisioningAttempts })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    const attempts = records[0]?.attempts ?? 1;
    const nextAttemptAt = retryAt(attempts, now);

    await transaction
      .update(orders)
      .set({
        provisioningErrorCode: errorCode,
        provisioningStatus: "failed",
        status: "provisioning_failed",
        updatedAt: now,
      })
      .where(eq(orders.id, orderId));
    await transaction
      .update(orderProvisioning)
      .set({
        lastErrorCode: errorCode,
        lockedAt: null,
        nextAttemptAt,
        state: "failed",
        updatedAt: now,
      })
      .where(eq(orderProvisioning.orderId, orderId));
  });
}

export async function provisionOrder(
  database: Database,
  marzban: Marzban,
  encryptionKey: string,
  orderId: string,
  now = new Date(),
): Promise<ProvisioningResult> {
  const claim = await claimOrder(database, orderId, now);

  if (!claim) {
    return { orderId, status: "skipped" };
  }

  try {
    const actualUser = await marzban.getUser(claim.marzbanUsername);
    const targetExpiresAt =
      claim.attemptsBeforeClaim === 0
        ? calculateSubscriptionExpiry({
            actualExpiresAt: actualUser?.expiresAt,
            durationDays: claim.durationDays,
            localExpiresAt: claim.localExpiresAt,
            paidAt: claim.paidAt,
          })
        : claim.targetExpiresAt;

    await database
      .update(orderProvisioning)
      .set({ targetExpiresAt, updatedAt: now })
      .where(eq(orderProvisioning.orderId, orderId));

    const provisionedUser =
      actualUser && isProvisionedAtTarget(actualUser, targetExpiresAt)
        ? actualUser
        : actualUser
          ? await marzban.updateUser({
              expiresAt: targetExpiresAt,
              username: claim.marzbanUsername,
            })
          : await marzban.createUser({
              expiresAt: targetExpiresAt,
              username: claim.marzbanUsername,
            });

    if (
      provisionedUser.username !== claim.marzbanUsername ||
      !isProvisionedAtTarget(provisionedUser, targetExpiresAt)
    ) {
      throw new ApplicationError(
        "MARZBAN_STATE_MISMATCH",
        "Marzban не подтвердил ожидаемое состояние подписки.",
      );
    }

    const finalExpiresAt = new Date(
      Math.max(
        targetExpiresAt.getTime(),
        provisionedUser.expiresAt?.getTime() ?? 0,
        claim.localExpiresAt?.getTime() ?? 0,
      ),
    );
    const encryptedSubscriptionUrl = encryptSubscriptionUrl(
      provisionedUser.subscriptionUrl,
      encryptionKey,
    );

    await database.transaction(async (transaction) => {
      await transaction
        .insert(subscriptions)
        .values({
          createdAt: now,
          expiresAt: finalExpiresAt,
          id: randomUUID(),
          lastSyncedAt: now,
          marzbanUsername: claim.marzbanUsername,
          startsAt: claim.localStartsAt ?? claim.paidAt,
          status: "active",
          subscriptionUrlEncrypted: encryptedSubscriptionUrl,
          updatedAt: now,
          userId: claim.userId,
          version: 1,
        })
        .onConflictDoUpdate({
          set: {
            expiresAt: finalExpiresAt,
            lastSyncedAt: now,
            marzbanUsername: claim.marzbanUsername,
            status: "active",
            subscriptionUrlEncrypted: encryptedSubscriptionUrl,
            updatedAt: now,
            version: sql`${subscriptions.version} + 1`,
          },
          target: subscriptions.userId,
        });
      await transaction
        .update(orders)
        .set({
          provisionedAt: now,
          provisioningErrorCode: null,
          provisioningStatus: "succeeded",
          status: "active",
          updatedAt: now,
        })
        .where(eq(orders.id, orderId));
      await transaction
        .update(orderProvisioning)
        .set({
          lastErrorCode: null,
          lockedAt: null,
          nextAttemptAt: null,
          state: "applied",
          targetExpiresAt: finalExpiresAt,
          updatedAt: now,
        })
        .where(eq(orderProvisioning.orderId, orderId));
    });

    return { orderId, status: "applied" };
  } catch (error) {
    const errorCode = normalizeErrorCode(error);

    logEvent("error", {
      errorCode,
      orderId,
      service: "marzban",
      timestamp: now.toISOString(),
    });
    await markFailed(database, orderId, errorCode, now);

    return { errorCode, orderId, status: "failed" };
  }
}

export async function runProvisioningBatch(
  database: Database,
  marzban: Marzban,
  encryptionKey: string,
  now = new Date(),
  limit = 20,
): Promise<ProvisioningResult[]> {
  const staleBefore = new Date(now.getTime() - LOCK_TIMEOUT_MILLISECONDS);
  const candidates = await database
    .select({ orderId: orderProvisioning.orderId })
    .from(orderProvisioning)
    .innerJoin(orders, eq(orders.id, orderProvisioning.orderId))
    .where(
      and(
        inArray(orders.status, ["paid", "provisioning", "provisioning_failed"]),
        or(
          eq(orderProvisioning.state, "pending"),
          and(
            eq(orderProvisioning.state, "failed"),
            or(
              isNull(orderProvisioning.nextAttemptAt),
              lte(orderProvisioning.nextAttemptAt, now),
            ),
          ),
          and(
            eq(orderProvisioning.state, "processing"),
            or(
              isNull(orderProvisioning.lockedAt),
              lte(orderProvisioning.lockedAt, staleBefore),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(orderProvisioning.createdAt))
    .limit(Math.max(1, Math.min(limit, 100)));
  const results: ProvisioningResult[] = [];

  for (const candidate of candidates) {
    results.push(
      await provisionOrder(
        database,
        marzban,
        encryptionKey,
        candidate.orderId,
        now,
      ),
    );
  }

  return results;
}

export async function requeueProvisioningOrder(
  database: Database,
  orderId: string,
  now = new Date(),
  adminUserId?: string,
): Promise<void> {
  await database.transaction(async (transaction) => {
    const records = await transaction
      .select({
        orderStatus: orders.status,
        paymentStatus: payments.status,
        provisioningState: orderProvisioning.state,
        source: orders.source,
      })
      .from(orders)
      .leftJoin(payments, eq(payments.orderId, orders.id))
      .innerJoin(orderProvisioning, eq(orderProvisioning.orderId, orders.id))
      .where(eq(orders.id, orderId))
      .limit(1);
    const order = records[0];
    // A grant carries no payment, so only purchases have to be settled.
    const settled =
      order?.source === "admin_grant" || order?.paymentStatus === "succeeded";

    if (
      !order ||
      !settled ||
      order.orderStatus !== "provisioning_failed" ||
      order.provisioningState !== "failed"
    ) {
      throw new ApplicationError(
        "PROVISIONING_RETRY_NOT_ALLOWED",
        "Повтор для этого заказа недоступен.",
      );
    }

    await transaction
      .update(orders)
      .set({
        provisioningErrorCode: null,
        provisioningStatus: "pending",
        status: "paid",
        updatedAt: now,
      })
      .where(eq(orders.id, orderId));
    await transaction
      .update(orderProvisioning)
      .set({
        lastErrorCode: null,
        lockedAt: null,
        nextAttemptAt: now,
        state: "pending",
        updatedAt: now,
      })
      .where(eq(orderProvisioning.orderId, orderId));

    if (adminUserId) {
      await transaction.insert(adminAuditLog).values(
        createAuditRecord({
          action: "order.provisioning_retry",
          adminUserId,
          after: {
            orderStatus: "paid",
            provisioningState: "pending",
          },
          before: {
            orderStatus: order.orderStatus,
            provisioningState: order.provisioningState,
          },
          entityId: orderId,
          entityType: "order",
          now,
        }),
      );
    }
  });
}

export async function reconcileSubscriptions(
  database: Database,
  marzban: Marzban,
  encryptionKey: string,
  now = new Date(),
  limit = 20,
): Promise<SubscriptionReconciliationResult> {
  const candidates = await database
    .select()
    .from(subscriptions)
    .where(gt(subscriptions.updatedAt, subscriptions.lastSyncedAt))
    .orderBy(asc(subscriptions.updatedAt))
    .limit(Math.max(1, Math.min(limit, 100)));
  let failed = 0;
  let synchronized = 0;

  for (const subscription of candidates) {
    try {
      const actual = await marzban.getUser(subscription.marzbanUsername);
      const reconciled =
        actual &&
        actual.expiresAt &&
        Math.abs(
          actual.expiresAt.getTime() - subscription.expiresAt.getTime(),
        ) <= 1_000
          ? actual
          : actual
            ? await marzban.updateUser({
                expiresAt: subscription.expiresAt,
                username: subscription.marzbanUsername,
              })
            : await marzban.createUser({
                expiresAt: subscription.expiresAt,
                username: subscription.marzbanUsername,
              });

      if (
        !reconciled.expiresAt ||
        Math.abs(
          reconciled.expiresAt.getTime() - subscription.expiresAt.getTime(),
        ) > 1_000
      ) {
        throw new ApplicationError(
          "MARZBAN_STATE_MISMATCH",
          "Marzban не подтвердил ожидаемую дату подписки.",
        );
      }

      await database
        .update(subscriptions)
        .set({
          lastSyncedAt: now,
          status:
            subscription.expiresAt.getTime() > now.getTime()
              ? "active"
              : "expired",
          subscriptionUrlEncrypted: encryptSubscriptionUrl(
            reconciled.subscriptionUrl,
            encryptionKey,
          ),
        })
        .where(
          and(
            eq(subscriptions.id, subscription.id),
            eq(subscriptions.version, subscription.version),
          ),
        );
      synchronized += 1;
    } catch (error) {
      failed += 1;
      logEvent("error", {
        errorCode: normalizeErrorCode(error),
        service: "marzban",
        subscriptionId: subscription.id,
        timestamp: now.toISOString(),
      });
    }
  }

  return {
    failed,
    inspected: candidates.length,
    synchronized,
  };
}

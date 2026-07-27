import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ApplicationError } from "../../src/lib/server/application-error";
import {
  createDatabase,
  type DatabaseContext,
} from "../../src/lib/server/db/client";
import { migrateDatabase } from "../../src/lib/server/db/migrate";
import {
  orderProvisioning,
  orders,
  paymentEvents,
  payments,
  plans,
  refunds,
  subscriptions,
  users,
} from "../../src/lib/server/db/schema";
import type {
  StarTransactionPage,
  TelegramStarsPayments,
} from "../../src/lib/server/integrations/payments/telegram-stars";
import { requestFullRefund } from "../../src/lib/server/modules/payments/refunds";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const REFUND_NOW = new Date("2026-07-27T12:01:00.000Z");
const ORIGINAL_EXPIRY = new Date("2026-09-25T12:00:00.000Z");
const ADJUSTED_EXPIRY = new Date("2026-08-26T12:00:00.000Z");

class RefundAdapterStub implements TelegramStarsPayments {
  readonly refundPayment = vi.fn(async () => undefined);

  answerPreCheckout(): Promise<void> {
    return Promise.resolve();
  }

  createInvoiceLink(): Promise<string> {
    return Promise.resolve("https://t.me/$fixture");
  }

  getTransactions(): Promise<StarTransactionPage> {
    return Promise.resolve({ nextOffset: null, transactions: [] });
  }
}

describe("Telegram Stars refunds", () => {
  let context: DatabaseContext;
  let paymentId: string;

  beforeAll(async () => {
    const dataDirectory = join(process.cwd(), "data");
    const databasePath = join(dataDirectory, "refunds-integration.sqlite");

    mkdirSync(dataDirectory, { recursive: true });

    for (const suffix of ["", "-shm", "-wal"]) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }

    context = await createDatabase(databasePath);
    await migrateDatabase(context);
  });

  beforeEach(async () => {
    await context.database.delete(paymentEvents);
    await context.database.delete(refunds);
    await context.database.delete(orderProvisioning);
    await context.database.delete(subscriptions);
    await context.database.delete(payments);
    await context.database.delete(orders);
    await context.database.delete(plans);
    await context.database.delete(users);

    const userId = randomUUID();
    const planId = randomUUID();
    const orderId = randomUUID();
    paymentId = randomUUID();

    await context.database.insert(users).values({
      firstName: "Daniil",
      id: userId,
      lastAuthenticatedAt: NOW,
      telegramUserId: "7000000012",
    });
    await context.database.insert(plans).values({
      durationDays: 30,
      id: planId,
      name: "Comfort",
      priceStars: 249,
    });
    await context.database.insert(orders).values({
      currency: "XTR",
      discountStars: 0,
      durationDaysSnapshot: 30,
      id: orderId,
      idempotencyKey: randomUUID(),
      planId,
      planNameSnapshot: "Comfort",
      priceStarsSnapshot: 249,
      provisionedAt: NOW,
      provisioningStatus: "succeeded",
      status: "active",
      subtotalStars: 249,
      totalStars: 249,
      userId,
    });
    await context.database.insert(payments).values({
      amountStars: 249,
      currency: "XTR",
      id: paymentId,
      invoicePayload: `v1:${randomUUID()}`,
      orderId,
      paidAt: NOW,
      status: "succeeded",
      telegramPaymentChargeId: "charge-refund-1",
    });
    await context.database.insert(orderProvisioning).values({
      appliedDurationDays: 30,
      orderId,
      state: "applied",
      targetExpiresAt: ORIGINAL_EXPIRY,
    });
    await context.database.insert(subscriptions).values({
      expiresAt: ORIGINAL_EXPIRY,
      id: randomUUID(),
      lastSyncedAt: NOW,
      marzbanUsername: `tg_${userId.replaceAll("-", "").slice(0, 24)}`,
      startsAt: NOW,
      status: "active",
      userId,
    });
  });

  afterAll(() => {
    context.close();
  });

  it("refunds once and revokes only the duration granted by the order", async () => {
    const adapter = new RefundAdapterStub();

    const first = await requestFullRefund(
      context.database,
      adapter,
      paymentId,
      "customer_request",
      REFUND_NOW,
    );
    const duplicate = await requestFullRefund(
      context.database,
      adapter,
      paymentId,
      "customer_request",
      REFUND_NOW,
    );
    const storedPayment = (
      await context.database
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
    )[0];
    const storedRefunds = await context.database.select().from(refunds);
    const subscription = (
      await context.database.select().from(subscriptions)
    )[0];

    expect(first).toEqual({ duplicate: false });
    expect(duplicate).toEqual({ duplicate: true });
    expect(adapter.refundPayment).toHaveBeenCalledTimes(1);
    expect(storedPayment?.status).toBe("refunded");
    expect(storedRefunds).toHaveLength(1);
    expect(storedRefunds[0]?.status).toBe("refunded");
    expect(subscription?.expiresAt).toEqual(ADJUSTED_EXPIRY);
    expect(subscription?.updatedAt.getTime()).toBeGreaterThan(
      subscription?.lastSyncedAt.getTime() ?? 0,
    );
  });

  it("keeps the payment succeeded when the provider rejects a refund", async () => {
    const adapter = new RefundAdapterStub();
    adapter.refundPayment.mockRejectedValueOnce(
      new ApplicationError("TELEGRAM_API_UNAVAILABLE", "Telegram unavailable"),
    );

    await expect(
      requestFullRefund(
        context.database,
        adapter,
        paymentId,
        "customer_request",
        REFUND_NOW,
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "TELEGRAM_API_UNAVAILABLE" }),
    );
    const storedPayment = (
      await context.database
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
    )[0];
    const storedRefund = (await context.database.select().from(refunds))[0];

    expect(storedPayment?.status).toBe("succeeded");
    expect(storedRefund?.status).toBe("refund_failed");
  });
});

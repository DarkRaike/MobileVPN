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
  promoCodes,
  users,
} from "../../src/lib/server/db/schema";
import type {
  CreateStarsInvoiceInput,
  StarTransactionPage,
  TelegramStarsPayments,
} from "../../src/lib/server/integrations/payments/telegram-stars";
import {
  confirmSuccessfulPayment,
  createOrderInvoice,
  validatePreCheckout,
} from "../../src/lib/server/modules/orders/orders";
import { reconcileTelegramStars } from "../../src/lib/server/modules/payments/reconciliation";

const NOW = new Date("2026-07-27T12:00:00.000Z");

class PaymentAdapterStub implements TelegramStarsPayments {
  readonly createInvoiceLink = vi.fn(
    async (input: CreateStarsInvoiceInput) =>
      `https://t.me/$invoice-${input.paymentAttemptId}`,
  );

  answerPreCheckout(): Promise<void> {
    return Promise.resolve();
  }

  readonly getTransactions = vi.fn(async (): Promise<StarTransactionPage> => ({
    nextOffset: null,
    transactions: [],
  }));

  refundPayment(): Promise<void> {
    return Promise.resolve();
  }
}

describe("Telegram Stars orders", () => {
  let context: DatabaseContext;
  let planId: string;
  let userId: string;

  beforeAll(async () => {
    const dataDirectory = join(process.cwd(), "data");
    const databasePath = join(dataDirectory, "payments-integration.sqlite");

    mkdirSync(dataDirectory, { recursive: true });

    for (const suffix of ["", "-shm", "-wal"]) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }

    context = await createDatabase(databasePath);
    await migrateDatabase(context);
  });

  beforeEach(async () => {
    await context.database.delete(paymentEvents);
    await context.database.delete(orderProvisioning);
    await context.database.delete(payments);
    await context.database.delete(orders);
    await context.database.delete(promoCodes);
    await context.database.delete(plans);
    await context.database.delete(users);

    planId = randomUUID();
    userId = randomUUID();

    await context.database.insert(users).values({
      firstName: "Daniil",
      id: userId,
      lastAuthenticatedAt: NOW,
      telegramUserId: "7000000012",
    });
    await context.database.insert(plans).values({
      currency: "XTR",
      durationDays: 30,
      id: planId,
      isActive: true,
      name: "Comfort",
      priceStars: 249,
    });
  });

  afterAll(() => {
    context.close();
  });

  it("recalculates the plan and promo snapshot on the server", async () => {
    const promoCodeId = randomUUID();
    const adapter = new PaymentAdapterStub();

    await context.database.insert(promoCodes).values({
      codeNormalized: "SAVE20",
      discountType: "percent",
      discountValue: 20,
      id: promoCodeId,
      isActive: true,
    });

    const result = await createOrderInvoice(
      context.database,
      adapter,
      userId,
      {
        idempotencyKey: randomUUID(),
        planId,
        promoCode: " save 20 ",
      },
      NOW,
    );
    const storedOrders = await context.database.select().from(orders);

    expect(result.amountStars).toBe(200);
    expect(storedOrders[0]).toEqual(
      expect.objectContaining({
        discountStars: 49,
        planNameSnapshot: "Comfort",
        promoCodeSnapshot: "SAVE20",
        subtotalStars: 249,
        totalStars: 200,
      }),
    );
    expect(adapter.createInvoiceLink).toHaveBeenCalledWith(
      expect.objectContaining({ amountStars: 200 }),
    );
  });

  it("confirms a payment once before external provisioning", async () => {
    const adapter = new PaymentAdapterStub();
    const invoice = await createOrderInvoice(
      context.database,
      adapter,
      userId,
      {
        idempotencyKey: randomUUID(),
        planId,
      },
      NOW,
    );
    const storedPayment = (await context.database.select().from(payments))[0];

    if (!storedPayment) {
      throw new Error("Expected a payment");
    }

    await validatePreCheckout(
      context.database,
      {
        amountStars: 249,
        currency: "XTR",
        invoicePayload: storedPayment.invoicePayload,
        telegramUserId: "7000000012",
      },
      NOW,
    );

    const input = {
      amountStars: 249,
      chargeId: "telegram-charge-1",
      currency: "XTR",
      eventId: "700000002",
      invoicePayload: storedPayment.invoicePayload,
      paidAt: NOW,
      telegramUserId: "7000000012",
    };
    const first = await confirmSuccessfulPayment(context.database, input);
    const duplicate = await confirmSuccessfulPayment(context.database, input);

    expect(first).toEqual({ duplicate: false, orderId: invoice.orderId });
    expect(duplicate).toEqual({ duplicate: true, orderId: null });
    expect(await context.database.select().from(paymentEvents)).toHaveLength(1);
    expect(
      await context.database.select().from(orderProvisioning),
    ).toHaveLength(1);
    expect(
      (
        await context.database
          .select()
          .from(orders)
          .where(eq(orders.id, invoice.orderId))
      )[0],
    ).toEqual(
      expect.objectContaining({
        provisioningStatus: "pending",
        status: "paid",
      }),
    );
  });

  it("rejects a pre-checkout amount changed by the client", async () => {
    const adapter = new PaymentAdapterStub();
    await createOrderInvoice(
      context.database,
      adapter,
      userId,
      {
        idempotencyKey: randomUUID(),
        planId,
      },
      NOW,
    );
    const storedPayment = (await context.database.select().from(payments))[0];

    await expect(
      validatePreCheckout(
        context.database,
        {
          amountStars: 1,
          currency: "XTR",
          invoicePayload: storedPayment?.invoicePayload ?? "",
          telegramUserId: "7000000012",
        },
        NOW,
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "PRE_CHECKOUT_REJECTED" }),
    );
  });

  it("recovers a missed successful payment from Stars transactions", async () => {
    const adapter = new PaymentAdapterStub();
    await createOrderInvoice(
      context.database,
      adapter,
      userId,
      {
        idempotencyKey: randomUUID(),
        planId,
      },
      NOW,
    );
    const storedPayment = (await context.database.select().from(payments))[0];

    if (!storedPayment) {
      throw new Error("Expected a pending payment");
    }

    adapter.getTransactions.mockResolvedValueOnce({
      nextOffset: null,
      transactions: [
        {
          amountStars: 249,
          date: NOW,
          id: "reconciled-charge-1",
          invoicePayload: storedPayment.invoicePayload,
          telegramUserId: "7000000012",
        },
      ],
    });

    const result = await reconcileTelegramStars(context.database, adapter, 1);
    const reconciledPayment = (
      await context.database
        .select()
        .from(payments)
        .where(eq(payments.id, storedPayment.id))
    )[0];

    expect(result).toEqual({ confirmed: 1, inspected: 1 });
    expect(reconciledPayment).toEqual(
      expect.objectContaining({
        status: "succeeded",
        telegramPaymentChargeId: "reconciled-charge-1",
      }),
    );
  });
});

import { randomBytes, randomUUID } from "node:crypto";
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
  adminAuditLog,
  orderProvisioning,
  orders,
  payments,
  plans,
  subscriptions,
  users,
} from "../../src/lib/server/db/schema";
import type {
  Marzban,
  MarzbanUser,
  MarzbanUserInput,
} from "../../src/lib/server/integrations/marzban/marzban";
import {
  provisionOrder,
  requeueProvisioningOrder,
} from "../../src/lib/server/modules/subscriptions/provisioning";
import { decryptSubscriptionUrl } from "../../src/lib/server/security/subscription-url";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const TARGET_EXPIRY = new Date("2026-08-26T12:00:00.000Z");

// Marzban stores `expire` as whole UNIX seconds and echoes back the truncated
// value, so the stub has to lose the milliseconds the real provider loses.
function marzbanUser(input: MarzbanUserInput): MarzbanUser {
  return {
    dataLimit: 0,
    expiresAt: new Date(Math.floor(input.expiresAt.getTime() / 1_000) * 1_000),
    inbounds: { vless: ["VLESS WS"] },
    status: "active",
    subscriptionUrl: "https://sub.example.com/sub/secret-token",
    usedTrafficBytes: 0,
    username: input.username,
  };
}

class MarzbanStub implements Marzban {
  readonly createUser = vi.fn(async (input: MarzbanUserInput) =>
    marzbanUser(input),
  );
  readonly getUser = vi.fn<Marzban["getUser"]>(async () => null);
  readonly updateUser = vi.fn(async (input: MarzbanUserInput) =>
    marzbanUser(input),
  );
}

describe("subscription provisioning", () => {
  let context: DatabaseContext;
  let encryptionKey: string;
  let orderId: string;
  let userId: string;

  beforeAll(async () => {
    const dataDirectory = join(process.cwd(), "data");
    const databasePath = join(dataDirectory, "provisioning-integration.sqlite");

    mkdirSync(dataDirectory, { recursive: true });

    for (const suffix of ["", "-shm", "-wal"]) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }

    context = await createDatabase(databasePath);
    await migrateDatabase(context);
  });

  beforeEach(async () => {
    await context.database.delete(adminAuditLog);
    await context.database.delete(orderProvisioning);
    await context.database.delete(subscriptions);
    await context.database.delete(payments);
    await context.database.delete(orders);
    await context.database.delete(plans);
    await context.database.delete(users);

    encryptionKey = randomBytes(32).toString("base64url");
    orderId = randomUUID();
    userId = randomUUID();
    const planId = randomUUID();

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
      provisioningStatus: "pending",
      status: "paid",
      subtotalStars: 249,
      totalStars: 249,
      userId,
    });
    await context.database.insert(payments).values({
      amountStars: 249,
      currency: "XTR",
      id: randomUUID(),
      invoicePayload: `v1:${randomUUID()}`,
      orderId,
      paidAt: NOW,
      status: "succeeded",
      telegramPaymentChargeId: `charge-${randomUUID()}`,
    });
    await context.database.insert(orderProvisioning).values({
      appliedDurationDays: 30,
      orderId,
      state: "pending",
      targetExpiresAt: TARGET_EXPIRY,
    });
  });

  afterAll(() => {
    context.close();
  });

  it("creates a Marzban user and commits the encrypted subscription once", async () => {
    const marzban = new MarzbanStub();

    const first = await provisionOrder(
      context.database,
      marzban,
      encryptionKey,
      orderId,
      NOW,
    );
    const duplicate = await provisionOrder(
      context.database,
      marzban,
      encryptionKey,
      orderId,
      NOW,
    );
    const storedSubscription = (
      await context.database.select().from(subscriptions)
    )[0];
    const storedOrder = (
      await context.database.select().from(orders).where(eq(orders.id, orderId))
    )[0];

    expect(first.status).toBe("applied");
    expect(duplicate.status).toBe("skipped");
    expect(marzban.createUser).toHaveBeenCalledTimes(1);
    expect(storedOrder).toEqual(
      expect.objectContaining({
        provisioningAttempts: 1,
        provisioningStatus: "succeeded",
        status: "active",
      }),
    );
    expect(storedSubscription?.subscriptionUrlEncrypted).not.toContain(
      "secret-token",
    );
    expect(
      decryptSubscriptionUrl(
        storedSubscription?.subscriptionUrlEncrypted ?? "",
        encryptionKey,
      ),
    ).toBe("https://sub.example.com/sub/secret-token");
  });

  it("keeps a paid order retryable while Marzban is unavailable", async () => {
    const marzban = new MarzbanStub();
    marzban.getUser.mockRejectedValueOnce(
      new ApplicationError(
        "MARZBAN_UNAVAILABLE",
        "Marzban temporarily unavailable",
      ),
    );

    const failed = await provisionOrder(
      context.database,
      marzban,
      encryptionKey,
      orderId,
      NOW,
    );
    const failedOrder = (
      await context.database.select().from(orders).where(eq(orders.id, orderId))
    )[0];

    expect(failed).toEqual({
      errorCode: "MARZBAN_UNAVAILABLE",
      orderId,
      status: "failed",
    });
    expect(failedOrder).toEqual(
      expect.objectContaining({
        provisioningErrorCode: "MARZBAN_UNAVAILABLE",
        provisioningStatus: "failed",
        status: "provisioning_failed",
      }),
    );

    await requeueProvisioningOrder(context.database, orderId, NOW, userId);
    const auditRecords = await context.database.select().from(adminAuditLog);
    const retried = await provisionOrder(
      context.database,
      marzban,
      encryptionKey,
      orderId,
      NOW,
    );

    expect(retried.status).toBe("applied");
    expect(marzban.createUser).toHaveBeenCalledTimes(1);
    expect(auditRecords).toEqual([
      expect.objectContaining({
        action: "order.provisioning_retry",
        adminUserId: userId,
        entityId: orderId,
        entityType: "order",
      }),
    ]);
  });
});

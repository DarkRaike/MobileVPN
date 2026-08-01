import { strict as assert } from "node:assert";
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
  MarzbanUserInput,
} from "../../src/lib/server/integrations/marzban/marzban";
import {
  grantSubscription,
  listGrantsForAdmin,
} from "../../src/lib/server/modules/subscriptions/grants";
import { provisionOrder } from "../../src/lib/server/modules/subscriptions/provisioning";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const ADMIN_TELEGRAM_ID = "900000001";
const MEMBER_TELEGRAM_ID = "900000002";

// Marzban stores `expire` as whole UNIX seconds and echoes back the truncated
// value, so the stub has to lose the milliseconds the real provider loses.
function marzbanUser(input: MarzbanUserInput) {
  return {
    dataLimit: 0,
    expiresAt: new Date(Math.floor(input.expiresAt.getTime() / 1_000) * 1_000),
    inbounds: { vless: ["VLESS TCP REALITY"] },
    status: "active" as const,
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

describe("administrator subscription grants", () => {
  let context: DatabaseContext;
  let adminUserId: string;
  let memberUserId: string;
  let encryptionKey: string;

  beforeAll(async () => {
    const dataDirectory = join(process.cwd(), "data");
    const databasePath = join(dataDirectory, "grants-integration.sqlite");

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
    adminUserId = randomUUID();
    memberUserId = randomUUID();

    await context.database.insert(users).values([
      {
        firstName: "Admin",
        id: adminUserId,
        lastAuthenticatedAt: NOW,
        telegramUserId: ADMIN_TELEGRAM_ID,
      },
      {
        firstName: "Member",
        id: memberUserId,
        lastAuthenticatedAt: NOW,
        telegramUserId: MEMBER_TELEGRAM_ID,
      },
    ]);
  });

  afterAll(() => {
    context.client.close();
  });

  it("creates a paid order without a payment and records the audit entry", async () => {
    const grant = await grantSubscription(
      context.database,
      {
        adminUserId,
        durationDays: 30,
        targetTelegramUserId: MEMBER_TELEGRAM_ID,
      },
      NOW,
    );

    const [order] = await context.database
      .select()
      .from(orders)
      .where(eq(orders.id, grant.orderId));
    assert(order);
    const paymentRows = await context.database
      .select()
      .from(payments)
      .where(eq(payments.orderId, grant.orderId));
    const [audit] = await context.database.select().from(adminAuditLog);
    assert(audit);

    expect(order.source).toBe("admin_grant");
    expect(order.status).toBe("paid");
    expect(order.planId).toBeNull();
    expect(order.totalStars).toBe(0);
    expect(order.subtotalStars).toBe(0);
    expect(paymentRows).toHaveLength(0);
    expect(grant.targetExpiresAt).toEqual(new Date("2026-08-26T12:00:00.000Z"));
    expect(audit.action).toBe("subscription.grant");
    expect(audit.adminUserId).toBe(adminUserId);
  });

  it("provisions the grant through the regular pipeline", async () => {
    const marzban = new MarzbanStub();
    const grant = await grantSubscription(
      context.database,
      {
        adminUserId,
        durationDays: 30,
        targetTelegramUserId: MEMBER_TELEGRAM_ID,
      },
      NOW,
    );

    const result = await provisionOrder(
      context.database,
      marzban,
      encryptionKey,
      grant.orderId,
      NOW,
    );

    const [subscription] = await context.database
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, memberUserId));
    assert(subscription);

    expect(result.status).toBe("applied");
    expect(marzban.createUser).toHaveBeenCalledTimes(1);
    expect(subscription.status).toBe("active");
    expect(subscription.expiresAt).toEqual(
      new Date("2026-08-26T12:00:00.000Z"),
    );
  });

  it("provisions a grant issued at a sub-second instant", async () => {
    const marzban = new MarzbanStub();
    const issuedAt = new Date("2026-07-27T12:00:00.456Z");
    const grant = await grantSubscription(
      context.database,
      {
        adminUserId,
        durationDays: 30,
        targetTelegramUserId: MEMBER_TELEGRAM_ID,
      },
      issuedAt,
    );

    const result = await provisionOrder(
      context.database,
      marzban,
      encryptionKey,
      grant.orderId,
      issuedAt,
    );

    const [order] = await context.database
      .select()
      .from(orders)
      .where(eq(orders.id, grant.orderId));
    const [subscription] = await context.database
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, memberUserId));
    assert(order);
    assert(subscription);

    expect(result.status).toBe("applied");
    expect(order.status).toBe("active");
    expect(order.provisioningErrorCode).toBeNull();
    expect(subscription.expiresAt).toEqual(
      new Date("2026-08-26T12:00:01.000Z"),
    );
  });

  it("recovers a grant whose stored target still carries milliseconds", async () => {
    const marzban = new MarzbanStub();
    const issuedAt = new Date("2026-07-27T12:00:00.000Z");
    const grant = await grantSubscription(
      context.database,
      {
        adminUserId,
        durationDays: 30,
        targetTelegramUserId: MEMBER_TELEGRAM_ID,
      },
      issuedAt,
    );

    // Reproduce a row written before the expiry precision was fixed: a failed
    // attempt whose persisted target can never be confirmed by Marzban.
    await context.database
      .update(orders)
      .set({
        provisioningAttempts: 1,
        provisioningErrorCode: "MARZBAN_STATE_MISMATCH",
        provisioningStatus: "failed",
        status: "provisioning_failed",
      })
      .where(eq(orders.id, grant.orderId));
    await context.database
      .update(orderProvisioning)
      .set({
        lastErrorCode: "MARZBAN_STATE_MISMATCH",
        state: "failed",
        targetExpiresAt: new Date("2026-08-26T12:00:00.456Z"),
      })
      .where(eq(orderProvisioning.orderId, grant.orderId));

    const result = await provisionOrder(
      context.database,
      marzban,
      encryptionKey,
      grant.orderId,
      issuedAt,
    );

    expect(result.status).toBe("applied");
  });

  it("extends an existing subscription instead of restarting it", async () => {
    const marzban = new MarzbanStub();
    const first = await grantSubscription(
      context.database,
      {
        adminUserId,
        durationDays: 30,
        targetTelegramUserId: MEMBER_TELEGRAM_ID,
      },
      NOW,
    );
    await provisionOrder(
      context.database,
      marzban,
      encryptionKey,
      first.orderId,
      NOW,
    );

    const second = await grantSubscription(
      context.database,
      {
        adminUserId,
        durationDays: 10,
        targetTelegramUserId: MEMBER_TELEGRAM_ID,
      },
      NOW,
    );

    expect(second.targetExpiresAt).toEqual(
      new Date("2026-09-05T12:00:00.000Z"),
    );
  });

  it("refuses to exceed the 365 day horizon", async () => {
    const marzban = new MarzbanStub();
    const first = await grantSubscription(
      context.database,
      {
        adminUserId,
        durationDays: 300,
        targetTelegramUserId: MEMBER_TELEGRAM_ID,
      },
      NOW,
    );
    await provisionOrder(
      context.database,
      marzban,
      encryptionKey,
      first.orderId,
      NOW,
    );

    await expect(
      grantSubscription(
        context.database,
        {
          adminUserId,
          durationDays: 100,
          targetTelegramUserId: MEMBER_TELEGRAM_ID,
        },
        NOW,
      ),
    ).rejects.toThrow(ApplicationError);
  });

  it("rejects a Telegram user that never opened the application", async () => {
    await expect(
      grantSubscription(
        context.database,
        {
          adminUserId,
          durationDays: 30,
          targetTelegramUserId: "900000999",
        },
        NOW,
      ),
    ).rejects.toMatchObject({ code: "GRANT_USER_NOT_FOUND" });

    expect(await context.database.select().from(orders)).toHaveLength(0);
  });

  it("lists grants without exposing purchases", async () => {
    await grantSubscription(
      context.database,
      {
        adminUserId,
        durationDays: 7,
        targetTelegramUserId: ADMIN_TELEGRAM_ID,
      },
      NOW,
    );

    const grants = await listGrantsForAdmin(context.database);

    expect(grants).toHaveLength(1);
    expect(grants[0]?.telegramUserId).toBe(ADMIN_TELEGRAM_ID);
  });
});

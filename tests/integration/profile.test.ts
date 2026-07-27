import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabase,
  type DatabaseContext,
} from "../../src/lib/server/db/client";
import { migrateDatabase } from "../../src/lib/server/db/migrate";
import {
  orders,
  payments,
  plans,
  subscriptions,
  users,
} from "../../src/lib/server/db/schema";
import { getProfileOverview } from "../../src/lib/server/modules/subscriptions/profile";
import { encryptSubscriptionUrl } from "../../src/lib/server/security/subscription-url";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
const SUBSCRIPTION_URL = "https://sub.example.com/sub/private-token";

describe("subscription profile", () => {
  let context: DatabaseContext;

  beforeEach(async () => {
    context = await createDatabase(":memory:");
    await migrateDatabase(context);
  });

  afterEach(() => {
    context.close();
  });

  it("returns the owner's active access, QR and immutable purchase snapshot", async () => {
    const userId = randomUUID();
    const planId = randomUUID();
    const orderId = randomUUID();

    await context.database.insert(users).values({
      firstName: "Daniil",
      id: userId,
      lastAuthenticatedAt: NOW,
      telegramUserId: "7000000012",
    });
    await context.database.insert(plans).values({
      durationDays: 30,
      id: planId,
      name: "Current plan name",
      priceStars: 299,
    });
    await context.database.insert(orders).values({
      currency: "XTR",
      discountStars: 50,
      durationDaysSnapshot: 30,
      id: orderId,
      idempotencyKey: randomUUID(),
      planId,
      planNameSnapshot: "Comfort",
      priceStarsSnapshot: 299,
      provisionedAt: NOW,
      provisioningStatus: "succeeded",
      status: "active",
      subtotalStars: 299,
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
      telegramPaymentChargeId: "charge-profile-1",
    });
    await context.database.insert(subscriptions).values({
      expiresAt: new Date("2026-08-26T12:00:00.000Z"),
      id: randomUUID(),
      lastSyncedAt: NOW,
      marzbanUsername: `tg_${userId.replaceAll("-", "").slice(0, 24)}`,
      startsAt: NOW,
      status: "active",
      subscriptionUrlEncrypted: encryptSubscriptionUrl(
        SUBSCRIPTION_URL,
        ENCRYPTION_KEY,
      ),
      userId,
    });

    const overview = await getProfileOverview(
      context.database,
      userId,
      ENCRYPTION_KEY,
      NOW,
    );

    expect(overview.subscription).toEqual(
      expect.objectContaining({
        planName: "Comfort",
        status: "active",
        subscriptionUrl: SUBSCRIPTION_URL,
      }),
    );
    expect(
      overview.subscription.status === "active"
        ? overview.subscription.qrCodeDataUrl
        : "",
    ).toMatch(/^data:image\/svg\+xml;base64,/u);
    expect(overview.purchaseHistory).toEqual([
      expect.objectContaining({
        discountStars: 50,
        planName: "Comfort",
        status: "active",
        subtotalStars: 299,
        totalStars: 249,
      }),
    ]);
  });

  it("fails closed when the stored subscription cannot be decrypted", async () => {
    const userId = randomUUID();

    await context.database.insert(users).values({
      firstName: "Daniil",
      id: userId,
      lastAuthenticatedAt: NOW,
      telegramUserId: "7000000013",
    });
    await context.database.insert(subscriptions).values({
      expiresAt: new Date("2026-08-26T12:00:00.000Z"),
      id: randomUUID(),
      lastSyncedAt: NOW,
      marzbanUsername: `tg_${userId.replaceAll("-", "").slice(0, 24)}`,
      startsAt: NOW,
      status: "active",
      subscriptionUrlEncrypted: encryptSubscriptionUrl(
        SUBSCRIPTION_URL,
        ENCRYPTION_KEY,
      ),
      userId,
    });

    const overview = await getProfileOverview(
      context.database,
      userId,
      Buffer.alloc(32, 8).toString("base64url"),
      NOW,
    );

    expect(overview.subscription).toEqual({ status: "error" });
  });
});

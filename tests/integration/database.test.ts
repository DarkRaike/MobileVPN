import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabase,
  type DatabaseContext,
} from "../../src/lib/server/db/client";
import { migrateDatabase } from "../../src/lib/server/db/migrate";
import { orders, plans, users } from "../../src/lib/server/db/schema";

describe("database constraints", () => {
  let context: DatabaseContext;

  beforeEach(async () => {
    context = await createDatabase(":memory:");
    await migrateDatabase(context);
  });

  afterEach(() => {
    context.close();
  });

  it("preserves Telegram user identifiers as unique text", async () => {
    const now = new Date();
    const telegramUserId = "9007199254740991";

    await context.database.insert(users).values({
      id: randomUUID(),
      firstName: "Daniil",
      lastAuthenticatedAt: now,
      telegramUserId,
    });

    await expect(
      context.database.insert(users).values({
        id: randomUUID(),
        firstName: "Duplicate",
        lastAuthenticatedAt: now,
        telegramUserId,
      }),
    ).rejects.toThrow();

    const storedUsers = await context.database.select().from(users);
    expect(storedUsers[0]?.telegramUserId).toBe(telegramUserId);
  });

  it("allows only one active featured plan", async () => {
    await context.database.insert(plans).values({
      id: randomUUID(),
      currency: "XTR",
      durationDays: 30,
      isActive: true,
      isFeatured: true,
      name: "Comfort",
      priceStars: 249,
    });

    await expect(
      context.database.insert(plans).values({
        id: randomUUID(),
        currency: "XTR",
        durationDays: 90,
        isActive: true,
        isFeatured: true,
        name: "Value",
        priceStars: 599,
      }),
    ).rejects.toThrow();
  });

  it("rejects inconsistent order amounts and protected plan deletion", async () => {
    const userId = randomUUID();
    const planId = randomUUID();
    const now = new Date();

    await context.database.insert(users).values({
      id: userId,
      firstName: "Daniil",
      lastAuthenticatedAt: now,
      telegramUserId: "123456789",
    });
    await context.database.insert(plans).values({
      id: planId,
      durationDays: 30,
      name: "Comfort",
      priceStars: 249,
    });

    await expect(
      context.database.insert(orders).values({
        id: randomUUID(),
        currency: "XTR",
        discountStars: 20,
        durationDaysSnapshot: 30,
        idempotencyKey: randomUUID(),
        planId,
        planNameSnapshot: "Comfort",
        priceStarsSnapshot: 249,
        subtotalStars: 249,
        totalStars: 249,
        userId,
      }),
    ).rejects.toThrow();

    await context.database.insert(orders).values({
      id: randomUUID(),
      currency: "XTR",
      discountStars: 0,
      durationDaysSnapshot: 30,
      idempotencyKey: randomUUID(),
      planId,
      planNameSnapshot: "Comfort",
      priceStarsSnapshot: 249,
      subtotalStars: 249,
      totalStars: 249,
      userId,
    });

    await expect(context.database.delete(plans)).rejects.toThrow();
  });
});

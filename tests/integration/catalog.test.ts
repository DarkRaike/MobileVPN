import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabase,
  type DatabaseContext,
} from "../../src/lib/server/db/client";
import { migrateDatabase } from "../../src/lib/server/db/migrate";
import {
  adminAuditLog,
  faqItems,
  orders,
  plans,
  promoCodePlans,
  promoCodes,
  users,
} from "../../src/lib/server/db/schema";
import {
  createPlan,
  listActivePlans,
  listPublishedFaq,
  validatePromoCode,
} from "../../src/lib/server/modules/catalog/catalog";
import {
  initialPlans,
  seedInitialCatalog,
} from "../../src/lib/server/modules/catalog/seed";

const NOW = new Date("2026-07-27T12:00:00.000Z");

describe("catalog", () => {
  let context: DatabaseContext;
  let userId: string;

  beforeAll(async () => {
    const dataDirectory = join(process.cwd(), "data");
    const databasePath = join(dataDirectory, "catalog-integration.sqlite");

    mkdirSync(dataDirectory, { recursive: true });

    for (const suffix of ["", "-shm", "-wal"]) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }

    context = await createDatabase(databasePath);
    await migrateDatabase(context);
  });

  beforeEach(async () => {
    await context.database.delete(adminAuditLog);
    await context.database.delete(faqItems);
    await context.database.delete(orders);
    await context.database.delete(promoCodePlans);
    await context.database.delete(promoCodes);
    await context.database.delete(plans);
    await context.database.delete(users);

    userId = randomUUID();

    await context.database.insert(users).values({
      id: userId,
      firstName: "Daniil",
      lastAuthenticatedAt: NOW,
      telegramUserId: "123456789",
    });
  });

  afterAll(() => {
    context.close();
  });

  it("seeds the initial plans idempotently in catalog order", async () => {
    await seedInitialCatalog(context.database, NOW);
    await seedInitialCatalog(context.database, NOW);

    const catalog = await listActivePlans(context.database);

    expect(catalog).toHaveLength(3);
    expect(catalog.map((plan) => [plan.durationDays, plan.priceStars])).toEqual(
      [
        [7, 99],
        [30, 249],
        [90, 599],
      ],
    );
    expect(catalog.filter((plan) => plan.isFeatured)).toHaveLength(1);
  });

  it("records an audit entry when an administrator creates a plan", async () => {
    const plan = await createPlan(context.database, userId, {
      currency: "XTR",
      description: "Test plan",
      durationDays: 14,
      isActive: true,
      isFeatured: false,
      name: "Test",
      priceStars: 149,
      sortOrder: 15,
    });

    const auditRecords = await context.database.select().from(adminAuditLog);

    expect(plan.name).toBe("Test");
    expect(auditRecords).toHaveLength(1);
    expect(auditRecords[0]).toEqual(
      expect.objectContaining({
        action: "plan.create",
        adminUserId: userId,
        entityId: plan.id,
        entityType: "plan",
      }),
    );
  });

  it("returns only published FAQ items in administrator order", async () => {
    await context.database.insert(faqItems).values([
      {
        answer: "Second answer",
        id: randomUUID(),
        isPublished: true,
        question: "Second question",
        sortOrder: 20,
      },
      {
        answer: "Hidden answer",
        id: randomUUID(),
        isPublished: false,
        question: "Hidden question",
        sortOrder: 0,
      },
      {
        answer: "First answer",
        id: randomUUID(),
        isPublished: true,
        question: "First question",
        sortOrder: 10,
      },
    ]);

    const publishedFaq = await listPublishedFaq(context.database);

    expect(publishedFaq.map((faq) => faq.question)).toEqual([
      "First question",
      "Second question",
    ]);
  });

  it("validates limits from successful orders and filters allowed plans", async () => {
    await seedInitialCatalog(context.database, NOW);
    const promoCodeId = randomUUID();

    await context.database.insert(promoCodes).values({
      id: promoCodeId,
      codeNormalized: "SAVE20",
      discountType: "percent",
      discountValue: 20,
      endsAt: new Date("2026-08-01T00:00:00.000Z"),
      isActive: true,
      maxUses: 2,
      maxUsesPerUser: 2,
      startsAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    await context.database.insert(promoCodePlans).values({
      planId: initialPlans[1].id,
      promoCodeId,
    });
    await context.database.insert(orders).values({
      id: randomUUID(),
      currency: "XTR",
      discountStars: 50,
      durationDaysSnapshot: 30,
      idempotencyKey: randomUUID(),
      planId: initialPlans[1].id,
      planNameSnapshot: "Comfort",
      priceStarsSnapshot: 249,
      promoCodeId,
      status: "paid",
      subtotalStars: 249,
      totalStars: 199,
      userId,
    });

    const validated = await validatePromoCode(
      context.database,
      userId,
      " save 20 ",
      NOW,
    );

    expect(validated.applicablePlanIds).toEqual([initialPlans[1].id]);
    expect(validated.preview).toEqual([
      {
        discountStars: 49,
        planId: initialPlans[1].id,
        totalStars: 200,
      },
    ]);

    await context.database.insert(orders).values({
      id: randomUUID(),
      currency: "XTR",
      discountStars: 50,
      durationDaysSnapshot: 30,
      idempotencyKey: randomUUID(),
      planId: initialPlans[1].id,
      planNameSnapshot: "Comfort",
      priceStarsSnapshot: 249,
      promoCodeId,
      status: "active",
      subtotalStars: 249,
      totalStars: 199,
      userId,
    });

    await expect(
      validatePromoCode(context.database, userId, "SAVE20", NOW),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "PROMO_LIMIT_REACHED" }),
    );
  });
});

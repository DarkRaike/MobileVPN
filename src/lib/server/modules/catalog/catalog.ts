import { randomUUID } from "node:crypto";

import { and, asc, count, desc, eq, inArray, notInArray } from "drizzle-orm";

import { ApplicationError } from "../../application-error";
import type { Database } from "../../db/client";
import {
  adminAuditLog,
  faqItems,
  orders,
  plans,
  promoCodePlans,
  promoCodes,
} from "../../db/schema";
import {
  assertPromoAvailable,
  calculateDiscountStars,
  normalizePromoCode,
  type DiscountType,
} from "../../domain/promo-codes";
import { createAuditRecord } from "../admin/audit";

type QueryDatabase = Pick<Database, "select">;

export interface PlanInput {
  currency: "XTR";
  description: string | null;
  durationDays: number;
  isActive: boolean;
  isFeatured: boolean;
  name: string;
  priceStars: number;
  sortOrder: number;
}

export interface PromoCodeInput {
  allowedPlanIds: string[];
  codeNormalized: string;
  currency: "XTR" | null;
  discountType: DiscountType;
  discountValue: number;
  endsAt: Date | null;
  isActive: boolean;
  maxUses: number | null;
  maxUsesPerUser: number | null;
  startsAt: Date | null;
}

export interface FaqInput {
  answer: string;
  isPublished: boolean;
  question: string;
  sortOrder: number;
}

const successfulOrderStatuses = [
  "paid",
  "provisioning",
  "active",
  "provisioning_failed",
  "refunded",
] as const;

function planSnapshot(plan: typeof plans.$inferSelect) {
  return {
    currency: plan.currency,
    description: plan.description,
    durationDays: plan.durationDays,
    isActive: plan.isActive,
    isFeatured: plan.isFeatured,
    name: plan.name,
    priceStars: plan.priceStars,
    sortOrder: plan.sortOrder,
  };
}

function promoSnapshot(
  promoCode: typeof promoCodes.$inferSelect,
  allowedPlanIds: string[],
) {
  return {
    allowedPlanIds,
    codeNormalized: promoCode.codeNormalized,
    currency: promoCode.currency,
    discountType: promoCode.discountType,
    discountValue: promoCode.discountValue,
    endsAt: promoCode.endsAt,
    isActive: promoCode.isActive,
    maxUses: promoCode.maxUses,
    maxUsesPerUser: promoCode.maxUsesPerUser,
    startsAt: promoCode.startsAt,
  };
}

function faqSnapshot(faq: typeof faqItems.$inferSelect) {
  return {
    answer: faq.answer,
    isPublished: faq.isPublished,
    question: faq.question,
    sortOrder: faq.sortOrder,
  };
}

async function findPlan(database: QueryDatabase, id: string) {
  const records = await database
    .select()
    .from(plans)
    .where(eq(plans.id, id))
    .limit(1);
  const plan = records[0];

  if (!plan) {
    throw new ApplicationError("PLAN_NOT_FOUND", "Тариф не найден.");
  }

  return plan;
}

async function findFaq(database: QueryDatabase, id: string) {
  const records = await database
    .select()
    .from(faqItems)
    .where(eq(faqItems.id, id))
    .limit(1);
  const faq = records[0];

  if (!faq) {
    throw new ApplicationError("FAQ_NOT_FOUND", "Вопрос не найден.");
  }

  return faq;
}

async function findPromoCode(database: QueryDatabase, id: string) {
  const records = await database
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.id, id))
    .limit(1);
  const promoCode = records[0];

  if (!promoCode) {
    throw new ApplicationError("PROMO_NOT_FOUND", "Промокод не найден.");
  }

  return promoCode;
}

async function validateAllowedPlans(
  database: QueryDatabase,
  planIds: string[],
): Promise<string[]> {
  const uniquePlanIds = [...new Set(planIds)];

  if (uniquePlanIds.length === 0) {
    return [];
  }

  const records = await database
    .select({ id: plans.id })
    .from(plans)
    .where(inArray(plans.id, uniquePlanIds));

  if (records.length !== uniquePlanIds.length) {
    throw new ApplicationError(
      "PROMO_PLAN_INVALID",
      "Один из выбранных тарифов не найден.",
    );
  }

  return uniquePlanIds;
}

export async function listActivePlans(database: Database) {
  return database
    .select({
      currency: plans.currency,
      description: plans.description,
      durationDays: plans.durationDays,
      id: plans.id,
      isFeatured: plans.isFeatured,
      name: plans.name,
      priceStars: plans.priceStars,
      sortOrder: plans.sortOrder,
    })
    .from(plans)
    .where(eq(plans.isActive, true))
    .orderBy(asc(plans.sortOrder), asc(plans.durationDays), asc(plans.name));
}

export async function listPublishedFaq(database: Database) {
  return database
    .select({
      answer: faqItems.answer,
      id: faqItems.id,
      question: faqItems.question,
      sortOrder: faqItems.sortOrder,
    })
    .from(faqItems)
    .where(eq(faqItems.isPublished, true))
    .orderBy(asc(faqItems.sortOrder), asc(faqItems.createdAt));
}

export async function listCatalogForAdmin(database: Database) {
  const [planRecords, promoRecords, faqRecords, allowedPlans] =
    await Promise.all([
      database
        .select()
        .from(plans)
        .orderBy(asc(plans.sortOrder), asc(plans.name)),
      database.select().from(promoCodes).orderBy(desc(promoCodes.createdAt)),
      database
        .select()
        .from(faqItems)
        .orderBy(asc(faqItems.sortOrder), asc(faqItems.createdAt)),
      database.select().from(promoCodePlans),
    ]);

  const planIdsByPromoCode = new Map<string, string[]>();

  for (const relation of allowedPlans) {
    const planIds = planIdsByPromoCode.get(relation.promoCodeId) ?? [];
    planIds.push(relation.planId);
    planIdsByPromoCode.set(relation.promoCodeId, planIds);
  }

  return {
    faqItems: faqRecords,
    plans: planRecords,
    promoCodes: promoRecords.map((promoCode) => ({
      ...promoCode,
      allowedPlanIds: planIdsByPromoCode.get(promoCode.id) ?? [],
    })),
  };
}

export async function createPlan(
  database: Database,
  adminUserId: string,
  input: PlanInput,
  now = new Date(),
) {
  return database.transaction(async (transaction) => {
    if (input.isActive && input.isFeatured) {
      await transaction
        .update(plans)
        .set({ isFeatured: false, updatedAt: now })
        .where(eq(plans.isFeatured, true));
    }

    const id = randomUUID();
    const records = await transaction
      .insert(plans)
      .values({ id, ...input, createdAt: now, updatedAt: now })
      .returning();
    const created = records[0];

    if (!created) {
      throw new Error("Plan insert returned no record");
    }

    await transaction.insert(adminAuditLog).values(
      createAuditRecord({
        action: "plan.create",
        adminUserId,
        after: planSnapshot(created),
        entityId: id,
        entityType: "plan",
        now,
      }),
    );

    return created;
  });
}

export async function updatePlan(
  database: Database,
  adminUserId: string,
  id: string,
  input: PlanInput,
  now = new Date(),
) {
  return database.transaction(async (transaction) => {
    const before = await findPlan(transaction, id);

    if (input.isActive && input.isFeatured) {
      await transaction
        .update(plans)
        .set({ isFeatured: false, updatedAt: now })
        .where(eq(plans.isFeatured, true));
    }

    const records = await transaction
      .update(plans)
      .set({ ...input, updatedAt: now })
      .where(eq(plans.id, id))
      .returning();
    const updated = records[0];

    if (!updated) {
      throw new Error("Plan update returned no record");
    }

    await transaction.insert(adminAuditLog).values(
      createAuditRecord({
        action: "plan.update",
        adminUserId,
        after: planSnapshot(updated),
        before: planSnapshot(before),
        entityId: id,
        entityType: "plan",
        now,
      }),
    );

    return updated;
  });
}

export async function deactivatePlan(
  database: Database,
  adminUserId: string,
  id: string,
  now = new Date(),
) {
  const before = await findPlan(database, id);

  return updatePlan(
    database,
    adminUserId,
    id,
    {
      ...planSnapshot(before),
      currency: "XTR",
      isActive: false,
      isFeatured: false,
    },
    now,
  );
}

export async function deletePlan(
  database: Database,
  adminUserId: string,
  id: string,
  now = new Date(),
): Promise<void> {
  await database.transaction(async (transaction) => {
    const before = await findPlan(transaction, id);
    const usage = await transaction
      .select({ value: count() })
      .from(orders)
      .where(eq(orders.planId, id));

    if ((usage[0]?.value ?? 0) > 0) {
      throw new ApplicationError(
        "PLAN_IN_USE",
        "Используемый тариф можно только деактивировать.",
      );
    }

    await transaction.delete(plans).where(eq(plans.id, id));
    await transaction.insert(adminAuditLog).values(
      createAuditRecord({
        action: "plan.delete",
        adminUserId,
        before: planSnapshot(before),
        entityId: id,
        entityType: "plan",
        now,
      }),
    );
  });
}

export async function createPromoCode(
  database: Database,
  adminUserId: string,
  input: PromoCodeInput,
  now = new Date(),
) {
  return database.transaction(async (transaction) => {
    const allowedPlanIds = await validateAllowedPlans(
      transaction,
      input.allowedPlanIds,
    );
    const id = randomUUID();
    const records = await transaction
      .insert(promoCodes)
      .values({
        id,
        codeNormalized: normalizePromoCode(input.codeNormalized),
        currency: input.currency,
        discountType: input.discountType,
        discountValue: input.discountValue,
        endsAt: input.endsAt,
        isActive: input.isActive,
        maxUses: input.maxUses,
        maxUsesPerUser: input.maxUsesPerUser,
        startsAt: input.startsAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const created = records[0];

    if (!created) {
      throw new Error("Promo code insert returned no record");
    }

    if (allowedPlanIds.length > 0) {
      await transaction.insert(promoCodePlans).values(
        allowedPlanIds.map((planId) => ({
          planId,
          promoCodeId: id,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    await transaction.insert(adminAuditLog).values(
      createAuditRecord({
        action: "promo.create",
        adminUserId,
        after: promoSnapshot(created, allowedPlanIds),
        entityId: id,
        entityType: "promo_code",
        now,
      }),
    );

    return { ...created, allowedPlanIds };
  });
}

export async function updatePromoCode(
  database: Database,
  adminUserId: string,
  id: string,
  input: PromoCodeInput,
  now = new Date(),
) {
  return database.transaction(async (transaction) => {
    const before = await findPromoCode(transaction, id);
    const previousRelations = await transaction
      .select({ planId: promoCodePlans.planId })
      .from(promoCodePlans)
      .where(eq(promoCodePlans.promoCodeId, id));
    const allowedPlanIds = await validateAllowedPlans(
      transaction,
      input.allowedPlanIds,
    );
    const records = await transaction
      .update(promoCodes)
      .set({
        codeNormalized: normalizePromoCode(input.codeNormalized),
        currency: input.currency,
        discountType: input.discountType,
        discountValue: input.discountValue,
        endsAt: input.endsAt,
        isActive: input.isActive,
        maxUses: input.maxUses,
        maxUsesPerUser: input.maxUsesPerUser,
        startsAt: input.startsAt,
        updatedAt: now,
      })
      .where(eq(promoCodes.id, id))
      .returning();
    const updated = records[0];

    if (!updated) {
      throw new Error("Promo code update returned no record");
    }

    await transaction
      .delete(promoCodePlans)
      .where(eq(promoCodePlans.promoCodeId, id));

    if (allowedPlanIds.length > 0) {
      await transaction.insert(promoCodePlans).values(
        allowedPlanIds.map((planId) => ({
          planId,
          promoCodeId: id,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    await transaction.insert(adminAuditLog).values(
      createAuditRecord({
        action: "promo.update",
        adminUserId,
        after: promoSnapshot(updated, allowedPlanIds),
        before: promoSnapshot(
          before,
          previousRelations.map((relation) => relation.planId),
        ),
        entityId: id,
        entityType: "promo_code",
        now,
      }),
    );

    return { ...updated, allowedPlanIds };
  });
}

export async function deactivatePromoCode(
  database: Database,
  adminUserId: string,
  id: string,
  now = new Date(),
) {
  const promoCode = await findPromoCode(database, id);
  const relations = await database
    .select({ planId: promoCodePlans.planId })
    .from(promoCodePlans)
    .where(eq(promoCodePlans.promoCodeId, id));

  return updatePromoCode(
    database,
    adminUserId,
    id,
    {
      ...promoSnapshot(
        promoCode,
        relations.map((relation) => relation.planId),
      ),
      allowedPlanIds: relations.map((relation) => relation.planId),
      codeNormalized: promoCode.codeNormalized,
      currency: promoCode.currency === "XTR" ? "XTR" : null,
      discountType: promoCode.discountType,
      isActive: false,
    },
    now,
  );
}

export async function deletePromoCode(
  database: Database,
  adminUserId: string,
  id: string,
  now = new Date(),
): Promise<void> {
  await database.transaction(async (transaction) => {
    const before = await findPromoCode(transaction, id);
    const relations = await transaction
      .select({ planId: promoCodePlans.planId })
      .from(promoCodePlans)
      .where(eq(promoCodePlans.promoCodeId, id));
    const usage = await transaction
      .select({ value: count() })
      .from(orders)
      .where(eq(orders.promoCodeId, id));

    if ((usage[0]?.value ?? 0) > 0) {
      throw new ApplicationError(
        "PROMO_IN_USE",
        "Используемый промокод можно только деактивировать.",
      );
    }

    await transaction.delete(promoCodes).where(eq(promoCodes.id, id));
    await transaction.insert(adminAuditLog).values(
      createAuditRecord({
        action: "promo.delete",
        adminUserId,
        before: promoSnapshot(
          before,
          relations.map((relation) => relation.planId),
        ),
        entityId: id,
        entityType: "promo_code",
        now,
      }),
    );
  });
}

export async function createFaq(
  database: Database,
  adminUserId: string,
  input: FaqInput,
  now = new Date(),
) {
  return database.transaction(async (transaction) => {
    const id = randomUUID();
    const records = await transaction
      .insert(faqItems)
      .values({ id, ...input, createdAt: now, updatedAt: now })
      .returning();
    const created = records[0];

    if (!created) {
      throw new Error("FAQ insert returned no record");
    }

    await transaction.insert(adminAuditLog).values(
      createAuditRecord({
        action: "faq.create",
        adminUserId,
        after: faqSnapshot(created),
        entityId: id,
        entityType: "faq",
        now,
      }),
    );

    return created;
  });
}

export async function updateFaq(
  database: Database,
  adminUserId: string,
  id: string,
  input: FaqInput,
  now = new Date(),
) {
  return database.transaction(async (transaction) => {
    const before = await findFaq(transaction, id);
    const records = await transaction
      .update(faqItems)
      .set({ ...input, updatedAt: now })
      .where(eq(faqItems.id, id))
      .returning();
    const updated = records[0];

    if (!updated) {
      throw new Error("FAQ update returned no record");
    }

    await transaction.insert(adminAuditLog).values(
      createAuditRecord({
        action: "faq.update",
        adminUserId,
        after: faqSnapshot(updated),
        before: faqSnapshot(before),
        entityId: id,
        entityType: "faq",
        now,
      }),
    );

    return updated;
  });
}

export async function deleteFaq(
  database: Database,
  adminUserId: string,
  id: string,
  now = new Date(),
): Promise<void> {
  await database.transaction(async (transaction) => {
    const before = await findFaq(transaction, id);
    await transaction.delete(faqItems).where(eq(faqItems.id, id));
    await transaction.insert(adminAuditLog).values(
      createAuditRecord({
        action: "faq.delete",
        adminUserId,
        before: faqSnapshot(before),
        entityId: id,
        entityType: "faq",
        now,
      }),
    );
  });
}

export async function validatePromoCode(
  database: Database,
  userId: string,
  code: string,
  now = new Date(),
) {
  const normalizedCode = normalizePromoCode(code);
  const records = await database
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.codeNormalized, normalizedCode))
    .limit(1);
  const promoCode = records[0];

  if (!promoCode) {
    throw new ApplicationError("PROMO_NOT_FOUND", "Промокод не найден.");
  }

  const [totalUsage, userUsage, relationRecords, activePlanRecords] =
    await Promise.all([
      database
        .select({ value: count() })
        .from(orders)
        .where(
          and(
            eq(orders.promoCodeId, promoCode.id),
            inArray(orders.status, successfulOrderStatuses),
          ),
        ),
      database
        .select({ value: count() })
        .from(orders)
        .where(
          and(
            eq(orders.promoCodeId, promoCode.id),
            eq(orders.userId, userId),
            notInArray(orders.status, ["pending_payment", "cancelled"]),
          ),
        ),
      database
        .select({ planId: promoCodePlans.planId })
        .from(promoCodePlans)
        .where(eq(promoCodePlans.promoCodeId, promoCode.id)),
      listActivePlans(database),
    ]);

  assertPromoAvailable(
    promoCode,
    {
      total: totalUsage[0]?.value ?? 0,
      user: userUsage[0]?.value ?? 0,
    },
    now,
  );

  const restrictedPlanIds = new Set(
    relationRecords.map((record) => record.planId),
  );
  const applicablePlans =
    restrictedPlanIds.size === 0
      ? activePlanRecords
      : activePlanRecords.filter((plan) => restrictedPlanIds.has(plan.id));

  if (applicablePlans.length === 0) {
    throw new ApplicationError(
      "PROMO_NOT_APPLICABLE",
      "Промокод не подходит к доступным тарифам.",
    );
  }

  return {
    applicablePlanIds: applicablePlans.map((plan) => plan.id),
    code: promoCode.codeNormalized,
    discountType: promoCode.discountType,
    discountValue: promoCode.discountValue,
    preview: applicablePlans.map((plan) => ({
      discountStars: calculateDiscountStars(
        plan.priceStars,
        promoCode.discountType,
        promoCode.discountValue,
      ),
      planId: plan.id,
      totalStars:
        plan.priceStars -
        calculateDiscountStars(
          plan.priceStars,
          promoCode.discountType,
          promoCode.discountValue,
        ),
    })),
  };
}

import { eq } from "drizzle-orm";

import type { Database } from "../../db/client";
import { plans } from "../../db/schema";

export const initialPlans = [
  {
    currency: "XTR",
    description: "Безлимитный трафик и до трёх личных устройств",
    durationDays: 7,
    id: "00000000-0000-4000-8000-000000000007",
    isActive: true,
    isFeatured: false,
    name: "Старт",
    priceStars: 99,
    sortOrder: 10,
  },
  {
    currency: "XTR",
    description: "Оптимальный тариф на каждый день",
    durationDays: 30,
    id: "00000000-0000-4000-8000-000000000030",
    isActive: true,
    isFeatured: true,
    name: "Комфорт",
    priceStars: 249,
    sortOrder: 20,
  },
  {
    currency: "XTR",
    description: "Максимальная выгода за день",
    durationDays: 90,
    id: "00000000-0000-4000-8000-000000000090",
    isActive: true,
    isFeatured: false,
    name: "Выгода",
    priceStars: 599,
    sortOrder: 30,
  },
] as const;

export async function seedInitialCatalog(
  database: Database,
  now = new Date(),
): Promise<void> {
  await database.transaction(async (transaction) => {
    const featured = await transaction
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.isFeatured, true))
      .limit(1);
    const canSeedFeatured = featured.length === 0;

    for (const plan of initialPlans) {
      await transaction
        .insert(plans)
        .values({
          ...plan,
          createdAt: now,
          isFeatured: plan.isFeatured && canSeedFeatured,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: plans.id });
    }
  });
}

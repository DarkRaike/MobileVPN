import { ApplicationError } from "../application-error";

export type DiscountType = "fixed" | "percent";

export interface PromoCodeRule {
  currency: string | null;
  discountType: DiscountType;
  discountValue: number;
  endsAt: Date | null;
  isActive: boolean;
  maxUses: number | null;
  maxUsesPerUser: number | null;
  startsAt: Date | null;
}

export interface PromoUsage {
  total: number;
  user: number;
}

export function normalizePromoCode(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, "").toUpperCase();
}

export function calculateDiscountStars(
  subtotalStars: number,
  discountType: DiscountType,
  discountValue: number,
): number {
  if (!Number.isSafeInteger(subtotalStars) || subtotalStars <= 0) {
    throw new ApplicationError(
      "PROMO_SUBTOTAL_INVALID",
      "Некорректная стоимость тарифа.",
    );
  }

  if (!Number.isSafeInteger(discountValue) || discountValue <= 0) {
    throw new ApplicationError(
      "PROMO_DISCOUNT_INVALID",
      "Некорректный размер скидки.",
    );
  }

  const discount =
    discountType === "percent"
      ? Math.floor((subtotalStars * Math.min(discountValue, 100)) / 100)
      : discountValue;

  return Math.min(subtotalStars, discount);
}

export function assertPromoAvailable(
  promoCode: PromoCodeRule,
  usage: PromoUsage,
  now: Date,
): void {
  if (!promoCode.isActive) {
    throw new ApplicationError("PROMO_INACTIVE", "Промокод недоступен.");
  }

  if (promoCode.startsAt && promoCode.startsAt.getTime() > now.getTime()) {
    throw new ApplicationError(
      "PROMO_NOT_STARTED",
      "Промокод пока недоступен.",
    );
  }

  if (promoCode.endsAt && promoCode.endsAt.getTime() <= now.getTime()) {
    throw new ApplicationError("PROMO_EXPIRED", "Срок промокода истёк.");
  }

  if (promoCode.maxUses !== null && usage.total >= promoCode.maxUses) {
    throw new ApplicationError(
      "PROMO_LIMIT_REACHED",
      "Лимит промокода исчерпан.",
    );
  }

  if (
    promoCode.maxUsesPerUser !== null &&
    usage.user >= promoCode.maxUsesPerUser
  ) {
    throw new ApplicationError(
      "PROMO_USER_LIMIT_REACHED",
      "Вы уже использовали этот промокод.",
    );
  }
}

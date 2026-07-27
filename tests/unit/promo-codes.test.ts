import { describe, expect, it } from "vitest";

import {
  assertPromoAvailable,
  calculateDiscountStars,
  normalizePromoCode,
} from "../../src/lib/server/domain/promo-codes";

const NOW = new Date("2026-07-27T12:00:00.000Z");

describe("promo code rules", () => {
  it("normalizes case, Unicode width and whitespace", () => {
    expect(normalizePromoCode("  ｓｕｍｍｅｒ 20 \n")).toBe("SUMMER20");
  });

  it("rounds percentage discounts down to whole Stars", () => {
    expect(calculateDiscountStars(99, "percent", 10)).toBe(9);
    expect(calculateDiscountStars(249, "percent", 25)).toBe(62);
  });

  it("caps fixed and percentage discounts at the subtotal", () => {
    expect(calculateDiscountStars(99, "fixed", 150)).toBe(99);
    expect(calculateDiscountStars(99, "percent", 100)).toBe(99);
  });

  it("rejects inactive, expired and exhausted promo codes", () => {
    const availablePromo = {
      currency: null,
      discountType: "percent" as const,
      discountValue: 10,
      endsAt: new Date("2026-07-28T12:00:00.000Z"),
      isActive: true,
      maxUses: 2,
      maxUsesPerUser: 1,
      startsAt: new Date("2026-07-26T12:00:00.000Z"),
    };

    expect(() =>
      assertPromoAvailable(availablePromo, { total: 1, user: 0 }, NOW),
    ).not.toThrow();
    expect(() =>
      assertPromoAvailable(
        { ...availablePromo, endsAt: NOW },
        { total: 0, user: 0 },
        NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: "PROMO_EXPIRED" }));
    expect(() =>
      assertPromoAvailable(availablePromo, { total: 2, user: 0 }, NOW),
    ).toThrowError(expect.objectContaining({ code: "PROMO_LIMIT_REACHED" }));
    expect(() =>
      assertPromoAvailable(availablePromo, { total: 1, user: 1 }, NOW),
    ).toThrowError(
      expect.objectContaining({ code: "PROMO_USER_LIMIT_REACHED" }),
    );
  });
});

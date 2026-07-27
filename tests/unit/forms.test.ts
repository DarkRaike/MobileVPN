import { describe, expect, it } from "vitest";

import {
  assertFormPayloadSize,
  parsePlanInput,
  parsePromoCodeInput,
  parseSupportTicketInput,
} from "../../src/lib/server/validation/forms";

describe("server form validation", () => {
  it("builds trusted plan input with a server-owned currency", () => {
    const formData = new FormData();
    formData.set("name", " Комфорт ");
    formData.set("description", " 30 дней ");
    formData.set("durationDays", "30");
    formData.set("priceStars", "249");
    formData.set("sortOrder", "20");
    formData.set("isActive", "on");
    formData.set("isFeatured", "on");
    formData.set("currency", "USD");

    expect(parsePlanInput(formData)).toEqual({
      currency: "XTR",
      description: "30 дней",
      durationDays: 30,
      isActive: true,
      isFeatured: true,
      name: "Комфорт",
      priceStars: 249,
      sortOrder: 20,
    });
  });

  it("normalizes promo codes and interprets admin dates as UTC", () => {
    const formData = new FormData();
    formData.set("code", " summer 20 ");
    formData.set("discountType", "fixed");
    formData.set("discountValue", "50");
    formData.set("startsAt", "2026-07-27T12:30");
    formData.set("endsAt", "2026-08-27T12:30");
    formData.set("maxUses", "100");
    formData.set("maxUsesPerUser", "1");
    formData.set("isActive", "on");
    formData.append("allowedPlanIds", "00000000-0000-4000-8000-000000000030");

    expect(parsePromoCodeInput(formData)).toEqual({
      allowedPlanIds: ["00000000-0000-4000-8000-000000000030"],
      codeNormalized: "SUMMER20",
      currency: "XTR",
      discountType: "fixed",
      discountValue: 50,
      endsAt: new Date("2026-08-27T12:30:00.000Z"),
      isActive: true,
      maxUses: 100,
      maxUsesPerUser: 1,
      startsAt: new Date("2026-07-27T12:30:00.000Z"),
    });
  });

  it("validates support fields and bounded form payloads", () => {
    const formData = new FormData();
    formData.set("subject", " Другое ");
    formData.set("message", " Нужна помощь с подключением. ");

    expect(parseSupportTicketInput(formData)).toEqual({
      message: "Нужна помощь с подключением.",
      subject: "Другое",
    });
    expect(() => assertFormPayloadSize(formData, 8)).toThrowError(
      expect.objectContaining({ code: "REQUEST_TOO_LARGE" }),
    );
  });
});

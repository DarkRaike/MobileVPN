import { describe, expect, it } from "vitest";

import {
  assertOrderTransition,
  assertPaymentTransition,
} from "../../src/lib/server/domain/order-state";
import {
  calculateSubscriptionExpiry,
  canExtendSubscription,
} from "../../src/lib/server/domain/subscriptions";

describe("order and subscription rules", () => {
  it("allows only server-defined order and payment transitions", () => {
    expect(() =>
      assertOrderTransition("pending_payment", "paid"),
    ).not.toThrow();
    expect(() => assertOrderTransition("active", "paid")).toThrowError(
      expect.objectContaining({ code: "ORDER_TRANSITION_INVALID" }),
    );
    expect(() => assertPaymentTransition("pending", "succeeded")).not.toThrow();
    expect(() => assertPaymentTransition("refunded", "succeeded")).toThrowError(
      expect.objectContaining({ code: "PAYMENT_TRANSITION_INVALID" }),
    );
  });

  it("extends from the latest actual, local or payment timestamp", () => {
    const result = calculateSubscriptionExpiry({
      actualExpiresAt: new Date("2026-08-15T00:00:00.000Z"),
      durationDays: 30,
      localExpiresAt: new Date("2026-08-10T00:00:00.000Z"),
      paidAt: new Date("2026-07-27T00:00:00.000Z"),
    });

    expect(result.toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });

  it("rejects a resulting horizon beyond 365 days from payment", () => {
    const now = new Date("2026-07-27T00:00:00.000Z");

    expect(
      canExtendSubscription(new Date("2027-07-20T00:00:00.000Z"), 30, now),
    ).toBe(false);
  });

  it("rounds the expiry up to the whole second Marzban can store", () => {
    const result = calculateSubscriptionExpiry({
      durationDays: 30,
      paidAt: new Date("2026-07-27T00:00:00.456Z"),
    });

    expect(result.toISOString()).toBe("2026-08-26T00:00:01.000Z");
  });

  it("still allows a full 365 day order paid at a sub-second instant", () => {
    const paidAt = new Date("2026-07-27T00:00:00.456Z");

    expect(canExtendSubscription(null, 365, paidAt)).toBe(true);
  });
});

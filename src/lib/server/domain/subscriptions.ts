import { ApplicationError } from "../application-error";

export const MAXIMUM_SUBSCRIPTION_DAYS = 365;
export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
export const MILLISECONDS_PER_SECOND = 1_000;

interface SubscriptionExpiryInput {
  actualExpiresAt?: Date | null;
  durationDays: number;
  localExpiresAt?: Date | null;
  paidAt: Date;
}

/**
 * Marzban stores `expire` as whole UNIX seconds, so an expiry carrying
 * milliseconds can never be confirmed by the provider: it echoes back a value
 * up to 999 ms earlier than the requested one. Rounding up keeps the whole
 * pipeline on one precision without taking paid time away from the subscriber.
 */
export function alignExpiryToWholeSecond(value: Date): Date {
  return new Date(
    Math.ceil(value.getTime() / MILLISECONDS_PER_SECOND) *
      MILLISECONDS_PER_SECOND,
  );
}

export function calculateSubscriptionExpiry({
  actualExpiresAt,
  durationDays,
  localExpiresAt,
  paidAt,
}: SubscriptionExpiryInput): Date {
  if (
    !Number.isSafeInteger(durationDays) ||
    durationDays <= 0 ||
    durationDays > MAXIMUM_SUBSCRIPTION_DAYS
  ) {
    throw new ApplicationError(
      "SUBSCRIPTION_DURATION_INVALID",
      "Некорректный срок подписки.",
    );
  }

  const paidAtMilliseconds = paidAt.getTime();
  const baseMilliseconds = Math.max(
    paidAtMilliseconds,
    actualExpiresAt?.getTime() ?? 0,
    localExpiresAt?.getTime() ?? 0,
  );
  const targetMilliseconds = alignExpiryToWholeSecond(
    new Date(baseMilliseconds + durationDays * MILLISECONDS_PER_DAY),
  ).getTime();
  // The horizon is measured from the same aligned instant, so a full 365 day
  // order still fits exactly instead of overflowing by the rounded remainder.
  const maximumMilliseconds =
    alignExpiryToWholeSecond(paidAt).getTime() +
    MAXIMUM_SUBSCRIPTION_DAYS * MILLISECONDS_PER_DAY;

  if (
    !Number.isSafeInteger(targetMilliseconds) ||
    targetMilliseconds > maximumMilliseconds
  ) {
    throw new ApplicationError(
      "SUBSCRIPTION_HORIZON_EXCEEDED",
      "Максимальный срок подписки — 365 дней.",
    );
  }

  return new Date(targetMilliseconds);
}

export function canExtendSubscription(
  localExpiresAt: Date | null,
  durationDays: number,
  now: Date,
): boolean {
  try {
    calculateSubscriptionExpiry({
      durationDays,
      localExpiresAt,
      paidAt: now,
    });
    return true;
  } catch (error) {
    if (
      error instanceof ApplicationError &&
      error.code === "SUBSCRIPTION_HORIZON_EXCEEDED"
    ) {
      return false;
    }

    throw error;
  }
}

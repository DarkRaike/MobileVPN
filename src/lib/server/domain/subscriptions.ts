import { ApplicationError } from "../application-error";

export const MAXIMUM_SUBSCRIPTION_DAYS = 365;
export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

interface SubscriptionExpiryInput {
  actualExpiresAt?: Date | null;
  durationDays: number;
  localExpiresAt?: Date | null;
  paidAt: Date;
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
  const targetMilliseconds =
    baseMilliseconds + durationDays * MILLISECONDS_PER_DAY;
  const maximumMilliseconds =
    paidAtMilliseconds + MAXIMUM_SUBSCRIPTION_DAYS * MILLISECONDS_PER_DAY;

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

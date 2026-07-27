const WINDOW_MILLISECONDS = 5 * 60 * 1_000;
const MAXIMUM_EVENTS_PER_METRIC = 10_000;

const events = {
  application5xx: [] as number[],
  telegramAuthFailures: [] as number[],
};

function record(target: number[], occurredAt: number): void {
  target.push(occurredAt);

  if (target.length > MAXIMUM_EVENTS_PER_METRIC) {
    target.splice(0, target.length - MAXIMUM_EVENTS_PER_METRIC);
  }
}

function countRecent(target: number[], now: number): number {
  const cutoff = now - WINDOW_MILLISECONDS;
  const recent = target.filter((occurredAt) => occurredAt >= cutoff);

  target.splice(0, target.length, ...recent);

  return target.length;
}

export function recordRequestOutcome(
  pathname: string,
  status: number,
  occurredAt = Date.now(),
): void {
  if (status >= 500) {
    record(events.application5xx, occurredAt);
  }

  if (pathname === "/api/auth/telegram" && status >= 400) {
    record(events.telegramAuthFailures, occurredAt);
  }
}

export function getRecentRequestMetrics(now = Date.now()): {
  application5xx: number;
  telegramAuthFailures: number;
  windowSeconds: number;
} {
  return {
    application5xx: countRecent(events.application5xx, now),
    telegramAuthFailures: countRecent(events.telegramAuthFailures, now),
    windowSeconds: WINDOW_MILLISECONDS / 1_000,
  };
}

export function resetRequestMetricsForTests(): void {
  events.application5xx.length = 0;
  events.telegramAuthFailures.length = 0;
}

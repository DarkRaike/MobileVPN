import { beforeEach, describe, expect, it } from "vitest";

import {
  getRecentRequestMetrics,
  recordRequestOutcome,
  resetRequestMetricsForTests,
} from "../../src/lib/server/observability/metrics";

describe("request metrics", () => {
  beforeEach(() => resetRequestMetricsForTests());

  it("counts only relevant outcomes inside the rolling window", () => {
    const now = Date.UTC(2026, 6, 28, 10, 0, 0);

    recordRequestOutcome("/api/auth/telegram", 401, now - 1_000);
    recordRequestOutcome("/api/auth/telegram", 500, now - 2_000);
    recordRequestOutcome("/api/auth/telegram", 401, now - 301_000);
    recordRequestOutcome("/", 503, now - 3_000);
    recordRequestOutcome("/", 200, now - 4_000);

    expect(getRecentRequestMetrics(now)).toEqual({
      application5xx: 2,
      telegramAuthFailures: 2,
      windowSeconds: 300,
    });
  });
});

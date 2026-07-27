import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { consumeRateLimit } from "../../src/lib/server/security/rate-limit";

describe("consumeRateLimit", () => {
  it("blocks requests after the limit until the window resets", () => {
    const key = randomUUID();
    const now = Date.parse("2026-07-27T12:00:00.000Z");

    expect(consumeRateLimit(key, 2, 60, now).allowed).toBe(true);
    expect(consumeRateLimit(key, 2, 60, now + 1).allowed).toBe(true);

    const blocked = consumeRateLimit(key, 2, 60, now + 2);
    expect(blocked).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });

    expect(consumeRateLimit(key, 2, 60, now + 60_000).allowed).toBe(true);
  });
});

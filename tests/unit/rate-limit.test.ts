import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { InMemoryRateLimiter } from "../../src/lib/server/security/rate-limit";

describe("InMemoryRateLimiter", () => {
  it("blocks requests after the limit until the window resets", () => {
    const limiter = new InMemoryRateLimiter();
    const key = randomUUID();
    const now = Date.parse("2026-07-27T12:00:00.000Z");

    expect(limiter.consume(key, 2, 60, now).allowed).toBe(true);
    expect(limiter.consume(key, 2, 60, now + 1).allowed).toBe(true);

    const blocked = limiter.consume(key, 2, 60, now + 2);
    expect(blocked).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });

    expect(limiter.consume(key, 2, 60, now + 60_000).allowed).toBe(true);
  });

  it("rejects unbounded keys and invalid limits", () => {
    const limiter = new InMemoryRateLimiter();

    expect(() => limiter.consume("x".repeat(513), 1, 60)).toThrow(RangeError);
    expect(() => limiter.consume("auth:test", 0, 60)).toThrow(RangeError);
    expect(() => limiter.consume("auth:test", 1, 0)).toThrow(RangeError);
  });
});

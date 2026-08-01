interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const MAXIMUM_BUCKETS = 10_000;
const MAXIMUM_KEY_LENGTH = 512;

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  consume(
    key: string,
    limit: number,
    windowSeconds: number,
    now = Date.now(),
  ): RateLimitResult {
    if (
      !key ||
      key.length > MAXIMUM_KEY_LENGTH ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !Number.isSafeInteger(windowSeconds) ||
      windowSeconds < 1 ||
      !Number.isFinite(now)
    ) {
      throw new RangeError("Invalid rate limit parameters");
    }

    if (this.buckets.size >= MAXIMUM_BUCKETS) {
      this.prune(now);
    }

    const existing = this.buckets.get(key);
    const bucket =
      !existing || existing.resetAt <= now
        ? { count: 0, resetAt: now + windowSeconds * 1000 }
        : existing;

    if (bucket.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.resetAt - now) / 1000),
        ),
      };
    }

    bucket.count += 1;
    this.buckets.set(key, bucket);

    return {
      allowed: true,
      retryAfterSeconds: 0,
    };
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }

    while (this.buckets.size >= MAXIMUM_BUCKETS) {
      const oldestKey = this.buckets.keys().next().value as string | undefined;

      if (!oldestKey) {
        break;
      }

      this.buckets.delete(oldestKey);
    }
  }
}

const rateLimiter = new InMemoryRateLimiter();

/**
 * `getClientAddress` throws when the address header the node adapter requires is
 * absent, which happens for every caller that reaches the application directly
 * instead of through the reverse proxy. Those callers are already authenticated
 * by a shared secret or a webhook secret, so they share a single bucket rather
 * than failing the request before the secret is even checked.
 */
export function resolveClientKey(getClientAddress: () => string): string {
  try {
    return getClientAddress();
  } catch {
    return "internal";
  }
}

export function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  now = Date.now(),
): RateLimitResult {
  return rateLimiter.consume(key, limit, windowSeconds, now);
}

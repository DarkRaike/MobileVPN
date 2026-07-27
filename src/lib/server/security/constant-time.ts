import { createHash, timingSafeEqual } from "node:crypto";

export function constantTimeEquals(
  received: string | null,
  expected: string,
): boolean {
  if (!received || !expected) {
    return false;
  }

  const receivedDigest = createHash("sha256").update(received).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();

  return timingSafeEqual(receivedDigest, expectedDigest);
}

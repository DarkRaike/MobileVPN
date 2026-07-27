import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptSubscriptionUrl,
  encryptSubscriptionUrl,
} from "../../src/lib/server/security/subscription-url";

describe("subscription URL encryption", () => {
  it("round-trips an authenticated encrypted subscription URL", () => {
    const key = randomBytes(32).toString("base64url");
    const subscriptionUrl = "https://sub.example.com/sub/secret-token";
    const encrypted = encryptSubscriptionUrl(subscriptionUrl, key);

    expect(encrypted).not.toContain(subscriptionUrl);
    expect(decryptSubscriptionUrl(encrypted, key)).toBe(subscriptionUrl);
  });

  it("rejects tampered ciphertext", () => {
    const key = randomBytes(32).toString("base64url");
    const encrypted = encryptSubscriptionUrl(
      "https://sub.example.com/sub/secret-token",
      key,
    );

    expect(() => decryptSubscriptionUrl(`${encrypted}x`, key)).toThrowError(
      expect.objectContaining({ code: "SUBSCRIPTION_DATA_INVALID" }),
    );
  });
});

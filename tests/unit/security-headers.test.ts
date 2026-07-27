import { describe, expect, it } from "vitest";

import { applySecurityHeaders } from "../../src/lib/server/security/headers";

describe("applySecurityHeaders", () => {
  it("sets browser protections without enabling HSTS in development", () => {
    const headers = new Headers();

    applySecurityHeaders(headers, false);

    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("permissions-policy")).toContain("camera=()");
    expect(headers.has("strict-transport-security")).toBe(false);
  });

  it("enables bounded HSTS in production", () => {
    const headers = new Headers();

    applySecurityHeaders(headers, true);

    expect(headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });
});

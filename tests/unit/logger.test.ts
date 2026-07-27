import { describe, expect, it } from "vitest";

import { sanitizeLogData } from "../../src/lib/server/observability/logger";

describe("sanitizeLogData", () => {
  it("redacts structured secrets and sensitive URLs", () => {
    const sanitized = sanitizeLogData({
      authorization: "Bearer private",
      nested: {
        botToken: "123456789:abcdefghijklmnopqrstuvwxyz_123456",
        message:
          "Failed https://sub.example.com/sub/private-access-token?client=ios",
      },
      requestId: "request-1",
    });
    const serialized = JSON.stringify(sanitized);

    expect(serialized).toContain('"requestId":"request-1"');
    expect(serialized).not.toContain("private-access-token");
    expect(serialized).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(serialized).not.toContain("Bearer private");
  });

  it("handles circular diagnostic data without throwing", () => {
    const diagnostic: Record<string, unknown> = {};
    diagnostic.self = diagnostic;

    expect(sanitizeLogData(diagnostic)).toEqual({ self: "[CIRCULAR]" });
  });
});

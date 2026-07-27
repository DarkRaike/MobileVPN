import { describe, expect, it } from "vitest";

import { formatSupportNotification } from "../../src/lib/server/integrations/telegram/support-notifier";

describe("support notification formatting", () => {
  it("places untrusted fields inside escaped code entities", () => {
    const formatted = formatSupportNotification({
      createdAt: new Date("2026-07-27T12:00:00.000Z"),
      firstName: "<Daniil>",
      lastName: null,
      message: '</pre><a href="https://example.com">@admin</a>',
      publicNumber: "AST-12345678",
      subject: "<script>alert(1)</script>",
      telegramUserId: "123456789",
      username: "darkraike",
    });

    expect(formatted.details).toContain(
      "<pre>&lt;script&gt;alert(1)&lt;/script&gt;</pre>",
    );
    expect(formatted.details).toContain("Username: <code>@darkraike</code>");
    expect(formatted.message).toContain("&lt;/pre&gt;");
    expect(formatted.message).not.toContain("<a href=");
    expect(formatted.message).not.toContain("</pre><a");
  });
});

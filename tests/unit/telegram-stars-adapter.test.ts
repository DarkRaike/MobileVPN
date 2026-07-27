import { describe, expect, it, vi } from "vitest";

import {
  createStarsInvoicePayload,
  TelegramStarsAdapter,
  verifyTelegramWebhookSecret,
} from "../../src/lib/server/integrations/payments/telegram-stars";

describe("TelegramStarsAdapter", () => {
  it("creates a minimal XTR invoice with one price", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: "https://t.me/$fixture-invoice",
        }),
        { status: 200 },
      ),
    );
    const adapter = new TelegramStarsAdapter("123:fixture-token", request);

    const invoiceUrl = await adapter.createInvoiceLink({
      amountStars: 249,
      description: "VPN access for 30 days",
      label: "Comfort",
      paymentAttemptId: "22222222-2222-4222-8222-222222222222",
      title: "Astra VPN",
    });

    expect(invoiceUrl).toBe("https://t.me/$fixture-invoice");
    const body = JSON.parse(
      String((request.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    );
    expect(body).toEqual({
      currency: "XTR",
      description: "VPN access for 30 days",
      payload: "v1:22222222-2222-4222-8222-222222222222",
      prices: [{ amount: 249, label: "Comfort" }],
      provider_token: "",
      title: "Astra VPN",
    });
  });

  it("validates opaque payloads and webhook secrets", () => {
    expect(
      createStarsInvoicePayload("22222222-2222-4222-8222-222222222222"),
    ).toBe("v1:22222222-2222-4222-8222-222222222222");
    expect(() => createStarsInvoicePayload("telegram-user-123")).toThrowError(
      expect.objectContaining({ code: "PAYMENT_ATTEMPT_ID_INVALID" }),
    );
    expect(
      verifyTelegramWebhookSecret("secret-value-123", "secret-value-123"),
    ).toBe(true);
    expect(
      verifyTelegramWebhookSecret("secret-value-124", "secret-value-123"),
    ).toBe(false);
  });
});

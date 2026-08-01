import { describe, expect, it, vi } from "vitest";

import { MarzbanAdapter } from "../../src/lib/server/integrations/marzban/marzban";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function userResponse() {
  return {
    created_at: "2026-07-27T12:00:00Z",
    data_limit: 0,
    expire: 1_778_846_400,
    inbounds: { vless: ["VLESS_TCP_REALITY_V1"] },
    proxies: { vless: { flow: "xtls-rprx-vision" } },
    status: "active",
    subscription_url: "https://sub.example.com/sub/fixture-token",
    used_traffic: 0,
    username: "tg_111111111111111111111111",
  };
}

describe("MarzbanAdapter", () => {
  it("authenticates and creates the pinned unlimited VLESS user shape", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "fixture-token", token_type: "bearer" }),
      )
      .mockResolvedValueOnce(jsonResponse(userResponse()));
    const adapter = new MarzbanAdapter({
      baseUrl: "http://marzban:8000",
      inboundTag: "VLESS_TCP_REALITY_V1",
      password: "fixture-password",
      request,
      username: "admin",
    });

    const user = await adapter.createUser({
      expiresAt: new Date("2026-05-15T00:00:00.000Z"),
      username: "tg_111111111111111111111111",
    });

    expect(user.subscriptionUrl).toBe(
      "https://sub.example.com/sub/fixture-token",
    );
    expect(user.usedTrafficBytes).toBe(0);
    const createRequest = request.mock.calls[1];
    const body = JSON.parse(
      String((createRequest?.[1] as RequestInit | undefined)?.body),
    );
    expect(body).toEqual({
      data_limit: 0,
      data_limit_reset_strategy: "no_reset",
      expire: 1_778_803_200,
      inbounds: { vless: ["VLESS_TCP_REALITY_V1"] },
      proxies: { vless: { flow: "xtls-rprx-vision" } },
      status: "active",
      username: "tg_111111111111111111111111",
    });
    expect(new Headers(createRequest?.[1]?.headers).get("authorization")).toBe(
      "Bearer fixture-token",
    );
  });

  it("rejects a malformed Marzban response at the adapter boundary", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "fixture-token", token_type: "bearer" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ ...userResponse(), subscription_url: "" }),
      );
    const adapter = new MarzbanAdapter({
      baseUrl: "http://marzban:8000",
      inboundTag: "VLESS_TCP_REALITY_V1",
      password: "fixture-password",
      request,
      username: "admin",
    });

    await expect(
      adapter.getUser("tg_111111111111111111111111"),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "MARZBAN_RESPONSE_INVALID" }),
    );
  });

  it("separates rejected credentials from a rejected token", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ detail: "Incorrect username" }, 401));
    const adapter = new MarzbanAdapter({
      baseUrl: "http://marzban:8000",
      inboundTag: "VLESS_TCP_REALITY_V1",
      password: "stale-password",
      request,
      username: "admin",
    });

    await expect(
      adapter.getUser("tg_111111111111111111111111"),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "MARZBAN_CREDENTIALS_REJECTED" }),
    );
    // Wrong credentials must not be replayed against the token endpoint.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("refreshes an expired token once before giving up", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "first-token", token_type: "bearer" }),
      )
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "second-token", token_type: "bearer" }),
      )
      .mockResolvedValueOnce(jsonResponse(userResponse()));
    const adapter = new MarzbanAdapter({
      baseUrl: "http://marzban:8000",
      inboundTag: "VLESS_TCP_REALITY_V1",
      password: "fixture-password",
      request,
      username: "admin",
    });

    const user = await adapter.getUser("tg_111111111111111111111111");

    expect(user?.username).toBe("tg_111111111111111111111111");
    expect(
      new Headers(request.mock.calls[3]?.[1]?.headers).get("authorization"),
    ).toBe("Bearer second-token");
  });
});

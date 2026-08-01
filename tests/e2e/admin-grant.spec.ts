import { createHmac, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

const botToken = "123456789:e2e_test_bot_token_abcdefghijklmnopqrstuvwxyz";
const providerUrl = "http://127.0.0.1:4174";
const adminTelegramUserId = 999999999;

function createTelegramInitData(
  telegramUserId: number,
  firstName: string,
): string {
  const parameters = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1_000)),
    query_id: randomUUID(),
    user: JSON.stringify({
      first_name: firstName,
      id: telegramUserId,
      language_code: "ru",
      username: `user_${telegramUserId}`,
    }),
  });
  const dataCheckString = [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  parameters.set("hash", hash);
  return parameters.toString();
}

async function installTelegramClient(
  page: Page,
  initData: string,
): Promise<void> {
  await page.route("https://telegram.org/js/telegram-web-app.js*", (route) =>
    route.fulfill({
      body: "",
      contentType: "application/javascript",
      status: 200,
    }),
  );
  await page.addInitScript((signedInitData) => {
    Object.assign(window, {
      Telegram: {
        WebApp: {
          BackButton: {
            hide() {},
            offClick() {},
            onClick() {},
            show() {},
          },
          colorScheme: "dark" as const,
          expand() {},
          initData: signedInitData,
          offEvent() {},
          onEvent() {},
          openInvoice() {},
          ready() {},
          setBackgroundColor() {},
          setBottomBarColor() {},
          setHeaderColor() {},
          themeParams: {
            bg_color: "#151616",
            hint_color: "#8b8d91",
            secondary_bg_color: "#202121",
            text_color: "#f5f7fa",
          },
          version: "9.6",
        },
      },
    });
  }, initData);
}

async function openAdminSection(page: Page, label: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  // The admin page is server rendered, so the tab only reacts once the island
  // has hydrated.
  await expect(async () => {
    await page.getByRole("button", { exact: true, name: label }).click();
    await expect(
      page.getByRole("button", { exact: true, name: label }),
    ).toHaveAttribute("aria-current", "page", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

test("grants VPN access without a payment and provisions it immediately", async ({
  page,
  request,
}) => {
  const resetResponse = await request.post(`${providerUrl}/test/reset`);
  expect(resetResponse.ok()).toBe(true);

  await installTelegramClient(
    page,
    createTelegramInitData(adminTelegramUserId, "Operator"),
  );

  const authResponse = page.waitForResponse((response) =>
    response.url().includes("/api/auth/telegram"),
  );
  await page.goto("/");
  expect((await authResponse).status()).toBe(200);

  const adminResponse = await page.goto("/admin");
  expect(adminResponse?.status()).toBe(200);

  await openAdminSection(page, "Доступ");
  await page
    .getByLabel("Telegram ID пользователя")
    .fill(String(adminTelegramUserId));
  await page.getByLabel("Срок, дней").fill("30");
  await page.getByRole("button", { name: "Выдать доступ" }).click();

  // A grant derives its expiry from the current instant, so this is the path
  // that regressed when the expiry carried milliseconds Marzban cannot store.
  await expect(page.getByRole("status")).toContainText("Доступ выдан до");
  await expect(page.getByText("Доступ выдан", { exact: true })).toBeVisible();

  const providerState = await request.get(`${providerUrl}/test/state`);
  expect(providerState.ok()).toBe(true);
  expect(
    ((await providerState.json()) as { createUserCalls: number })
      .createUserCalls,
  ).toBe(1);

  await openAdminSection(page, "Заказы");
  const order = page.locator("article.admin-card").first();
  await expect(order).toContainText("Доступ от администратора");
  await expect(order).toContainText("Выдан");
  await expect(order).not.toContainText("Безопасный код ошибки");
});

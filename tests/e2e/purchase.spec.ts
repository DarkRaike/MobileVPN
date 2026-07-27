import { createHmac, randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const providerUrl = "http://127.0.0.1:4174";
const botToken = "123456789:e2e_test_bot_token_abcdefghijklmnopqrstuvwxyz";
const webhookSecret = "w".repeat(32);
const internalJobSecret = "j".repeat(32);

interface ProviderState {
  answerPreCheckoutCalls: number;
  createUserCalls: number;
  lastInvoice: {
    currency: string;
    payload: string;
    prices: Array<{ amount: number; label: string }>;
  } | null;
  marzbanAvailable: boolean;
  updateUserCalls: number;
  userCount: number;
}

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
  version = "9.6",
): Promise<void> {
  await page.route("https://telegram.org/js/telegram-web-app.js*", (route) =>
    route.fulfill({
      body: "",
      contentType: "application/javascript",
      status: 200,
    }),
  );
  await page.addInitScript(
    ({ signedInitData, telegramVersion }) => {
      const themeCallbacks = new Set<() => void>();
      const backCallbacks = new Set<() => void>();
      const webApp = {
        BackButton: {
          hide() {},
          offClick(callback: () => void) {
            backCallbacks.delete(callback);
          },
          onClick(callback: () => void) {
            backCallbacks.add(callback);
          },
          show() {},
        },
        colorScheme: "dark" as const,
        expand() {},
        initData: signedInitData,
        offEvent(_event: "themeChanged", callback: () => void) {
          themeCallbacks.delete(callback);
        },
        onEvent(_event: "themeChanged", callback: () => void) {
          themeCallbacks.add(callback);
        },
        openInvoice(url: string, callback?: (status: "paid") => void) {
          Object.assign(window, { __lastInvoiceUrl: url });
          callback?.("paid");
        },
        ready() {},
        setBackgroundColor() {},
        setBottomBarColor() {},
        setHeaderColor() {},
        themeParams: {
          accent_text_color: "#4d96ff",
          bg_color: "#151616",
          button_color: "#4d96ff",
          button_text_color: "#ffffff",
          hint_color: "#8b8d91",
          secondary_bg_color: "#202121",
          text_color: "#f5f7fa",
        },
        version: telegramVersion,
      };

      Object.assign(window, { Telegram: { WebApp: webApp } });
    },
    { signedInitData: initData, telegramVersion: version },
  );
}

async function getProviderState(
  request: APIRequestContext,
): Promise<ProviderState> {
  const response = await request.get(`${providerUrl}/test/state`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<ProviderState>;
}

async function resetProvider(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${providerUrl}/test/reset`);
  expect(response.ok()).toBe(true);
}

async function submitSuccessfulPayment(
  request: APIRequestContext,
  telegramUserId: number,
  invoice: NonNullable<ProviderState["lastInvoice"]>,
  updateId: number,
): Promise<void> {
  const amount = invoice.prices[0]?.amount;

  if (!amount) {
    throw new Error("Expected an invoice amount");
  }

  const preCheckout = await request.post("/api/telegram/webhook", {
    data: {
      pre_checkout_query: {
        currency: invoice.currency,
        from: { id: telegramUserId },
        id: `pre-checkout-${updateId}`,
        invoice_payload: invoice.payload,
        total_amount: amount,
      },
      update_id: updateId,
    },
    headers: {
      "x-telegram-bot-api-secret-token": webhookSecret,
    },
  });
  expect(preCheckout.ok()).toBe(true);

  const successfulPaymentUpdate = {
    message: {
      date: Math.floor(Date.now() / 1_000),
      from: { id: telegramUserId },
      successful_payment: {
        currency: invoice.currency,
        invoice_payload: invoice.payload,
        telegram_payment_charge_id: `charge-${updateId}`,
        total_amount: amount,
      },
    },
    update_id: updateId + 1,
  };
  const successful = await request.post("/api/telegram/webhook", {
    data: successfulPaymentUpdate,
    headers: {
      "x-telegram-bot-api-secret-token": webhookSecret,
    },
  });
  expect(successful.ok()).toBe(true);

  const duplicate = await request.post("/api/telegram/webhook", {
    data: successfulPaymentUpdate,
    headers: {
      "x-telegram-bot-api-secret-token": webhookSecret,
    },
  });
  expect(duplicate.ok()).toBe(true);
}

async function runReconciliation(request: APIRequestContext): Promise<number> {
  const response = await request.post("/api/internal/jobs/reconcile", {
    headers: {
      "x-internal-job-secret": internalJobSecret,
    },
  });

  return response.status();
}

test("completes signed auth, discounted payment and idempotent provisioning", async ({
  page,
  request,
}) => {
  const telegramUserId = 910000001;

  await resetProvider(request);
  await installTelegramClient(
    page,
    createTelegramInitData(telegramUserId, "Daniil"),
  );

  const initialResponse = await page.goto("/");
  expect(initialResponse?.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'self' https://web.telegram.org",
  );
  expect(initialResponse?.headers()["x-content-type-options"]).toBe("nosniff");
  await expect(
    page.getByRole("heading", { name: "Выберите свой тариф" }),
  ).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Профиль" }).click();
  await page.getByLabel("Промокод").fill("E2E20");
  await page.getByRole("button", { name: "Применить" }).click();
  await expect(page.getByText("Промокод применён: скидка 20%.")).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Главная" }).click();
  await page.getByLabel("Подтверждаю условия покупки").check();
  const comfortPlan = page.locator("article.tariff").filter({
    has: page.getByText("Комфорт", { exact: true }),
  });

  await comfortPlan.locator("form").evaluate((form) => {
    const tamperedPrice = document.createElement("input");
    tamperedPrice.name = "priceStars";
    tamperedPrice.value = "1";
    form.append(tamperedPrice);
  });
  await comfortPlan.getByRole("button", { name: "Купить" }).click();
  await expect(
    page.getByText("Telegram принял оплату. Ожидаем серверное подтверждение."),
  ).toBeVisible();

  const providerState = await getProviderState(request);
  const invoice = providerState.lastInvoice;

  expect(invoice).not.toBeNull();
  expect(invoice?.prices).toEqual([{ amount: 200, label: "Комфорт" }]);

  if (!invoice) {
    throw new Error("Expected a created invoice");
  }

  await submitSuccessfulPayment(request, telegramUserId, invoice, 700_000_000);
  expect(await runReconciliation(request)).toBe(200);
  expect(await runReconciliation(request)).toBe(200);

  await page.reload();
  await page.getByRole("button", { exact: true, name: "Профиль" }).click();
  await expect(page.getByText("Активна", { exact: true })).toBeVisible();
  await expect(
    page.getByAltText("QR-код ссылки подключения Astra VPN"),
  ).toBeVisible();
  await expect(
    page.getByText(/https:\/\/sub\.example\.test\/sub\/e2e-/u),
  ).toBeVisible();

  const finalProviderState = await getProviderState(request);
  expect(finalProviderState.answerPreCheckoutCalls).toBe(1);
  expect(finalProviderState.createUserCalls).toBe(1);
  expect(finalProviderState.updateUserCalls).toBe(0);

  const adminResponse = await page.goto("/admin");
  expect(adminResponse?.status()).toBe(403);
});

test("rejects forged Telegram initData", async ({ page }) => {
  await installTelegramClient(
    page,
    `auth_date=1770000000&user=%7B%22id%22%3A1%7D&hash=${"0".repeat(64)}`,
  );
  await page.goto("/");

  await expect(
    page.getByText("Не удалось подтвердить данные Telegram."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Повторить вход" }),
  ).toBeVisible();
});

test("rejects an outdated Telegram client before creating an invoice", async ({
  page,
  request,
}) => {
  await resetProvider(request);
  await installTelegramClient(
    page,
    createTelegramInitData(910000003, "Legacy"),
    "6.0",
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Выберите свой тариф" }),
  ).toBeVisible();

  await page.getByLabel("Подтверждаю условия покупки").check();
  const starterPlan = page.locator("article.tariff").filter({
    has: page.getByText("Старт", { exact: true }),
  });
  await starterPlan.getByRole("button", { name: "Купить" }).click();
  await expect(
    page.getByText(
      "Обновите Telegram до актуальной версии, чтобы оплатить счёт.",
    ),
  ).toBeVisible();
  expect((await getProviderState(request)).lastInvoice).toBeNull();
});

test("keeps a confirmed payment retryable when Marzban is unavailable", async ({
  page,
  request,
}) => {
  const telegramUserId = 910000002;

  await resetProvider(request);
  await installTelegramClient(
    page,
    createTelegramInitData(telegramUserId, "Student"),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Выберите свой тариф" }),
  ).toBeVisible();

  await page.getByLabel("Подтверждаю условия покупки").check();
  const starterPlan = page.locator("article.tariff").filter({
    has: page.getByText("Старт", { exact: true }),
  });
  await starterPlan.getByRole("button", { name: "Купить" }).click();
  await expect(
    page.getByText("Telegram принял оплату. Ожидаем серверное подтверждение."),
  ).toBeVisible();

  const providerState = await getProviderState(request);
  const invoice = providerState.lastInvoice;

  expect(invoice).not.toBeNull();

  if (!invoice) {
    throw new Error("Expected a created invoice");
  }

  await submitSuccessfulPayment(request, telegramUserId, invoice, 710_000_000);

  const unavailableResponse = await request.post(
    `${providerUrl}/test/marzban-availability`,
    { data: { available: false } },
  );
  expect(unavailableResponse.ok()).toBe(true);
  expect(await runReconciliation(request)).toBe(200);

  await page.goto("/?section=profile");
  await expect(
    page.getByRole("heading", {
      name: "Оплата получена, доступ создаётся",
    }),
  ).toBeVisible();
  await expect(page.getByText(/Marzban временно недоступен/u)).toBeVisible();
});

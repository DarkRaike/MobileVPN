import { fail, redirect } from "@sveltejs/kit";

import { ApplicationError } from "$lib/server/application-error";
import { isAdminUser } from "$lib/server/auth/admin";
import {
  deleteSessionCookie,
  getSessionCookieName,
} from "$lib/server/auth/cookies";
import { revokeSession } from "$lib/server/auth/sessions";
import { getRuntimeConfig } from "$lib/server/config/runtime";
import { getDatabase } from "$lib/server/db/runtime";
import { getMarzban } from "$lib/server/integrations/marzban/runtime";
import { getTelegramStarsPayments } from "$lib/server/integrations/payments/runtime";
import {
  TelegramSupportNotifier,
  UnavailableSupportNotifier,
} from "$lib/server/integrations/telegram/support-notifier";
import { logEvent } from "$lib/server/observability/logger";
import {
  listActivePlans,
  listPublishedFaq,
  validatePromoCode,
} from "$lib/server/modules/catalog/catalog";
import { createOrderInvoice } from "$lib/server/modules/orders/orders";
import { getProfileOverview } from "$lib/server/modules/subscriptions/profile";
import { createSupportTicket } from "$lib/server/modules/support/support";
import { consumeRateLimit } from "$lib/server/security/rate-limit";
import {
  assertFormPayloadSize,
  assertRequestSize,
  isValidationError,
  parsePromoApplication,
  parsePurchaseInput,
  parseSupportTicketInput,
} from "$lib/server/validation/forms";

import type { Actions, PageServerLoad } from "./$types";

const FORM_MAXIMUM_BYTES = 16 * 1024;
const PROMO_RATE_LIMIT = 15;
const PROMO_RATE_LIMIT_WINDOW_SECONDS = 60;
const PURCHASE_RATE_LIMIT = 5;
const PURCHASE_RATE_LIMIT_WINDOW_SECONDS = 60;
const SUPPORT_RATE_LIMIT = 5;
const SUPPORT_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

function actionError(
  action: "promo" | "purchase" | "support",
  error: unknown,
  fallbackMessage: string,
) {
  if (error instanceof ApplicationError) {
    return fail(error.code === "REQUEST_TOO_LARGE" ? 413 : 400, {
      action,
      code: error.code,
      message: error.message,
      ok: false as const,
    });
  }

  if (isValidationError(error)) {
    return fail(400, {
      action,
      code: "FORM_INVALID",
      message: "Проверьте заполнение формы.",
      ok: false as const,
    });
  }

  logEvent("error", {
    errorCode:
      action === "support"
        ? "SUPPORT_CREATE_FAILED"
        : action === "purchase"
          ? "ORDER_CREATE_FAILED"
          : "PROMO_VALIDATE_FAILED",
    errorType: error instanceof Error ? error.name : "UnknownError",
  });

  return fail(500, {
    action,
    code: "INTERNAL_ERROR",
    message: fallbackMessage,
    ok: false as const,
  });
}

export const load: PageServerLoad = async ({ locals }) => {
  const config = getRuntimeConfig();
  let profileOverview: Awaited<ReturnType<typeof getProfileOverview>> = {
    purchaseHistory: [],
    subscription: { status: "none" },
  };
  const { database } = await getDatabase();
  const [activePlans, faqItems] = await Promise.all([
    listActivePlans(database),
    listPublishedFaq(database),
  ]);

  if (locals.user) {
    const marzban = config.liveOperationsEnabled
      ? getMarzban(config)
      : undefined;

    profileOverview = await getProfileOverview(
      database,
      locals.user.id,
      config.subscriptionUrlEncryptionKey,
      undefined,
      marzban,
    );
  }

  return {
    activePlans,
    developmentMockAuthEnabled: config.developmentMock.enabled,
    faqItems,
    isAdmin: isAdminUser(locals.user, config.telegramAdminUserId),
    profileOverview,
    purchasesEnabled: config.liveOperationsEnabled,
    sessionExpiresAt: locals.session?.expiresAt ?? null,
    user: locals.user,
  };
};

export const actions = {
  createOrder: async ({ getClientAddress, locals, request }) => {
    const user = locals.user;

    if (!user) {
      return fail(401, {
        action: "purchase",
        code: "AUTH_REQUIRED",
        message: "Сначала войдите через Telegram.",
        ok: false as const,
      });
    }

    const config = getRuntimeConfig();

    if (!config.liveOperationsEnabled) {
      return fail(503, {
        action: "purchase",
        code: "LIVE_OPERATIONS_DISABLED",
        message: "Покупки временно недоступны.",
        ok: false as const,
      });
    }

    const rateLimit = consumeRateLimit(
      `purchase:${user.id}:${getClientAddress()}`,
      PURCHASE_RATE_LIMIT,
      PURCHASE_RATE_LIMIT_WINDOW_SECONDS,
    );

    if (!rateLimit.allowed) {
      return fail(429, {
        action: "purchase",
        code: "PURCHASE_RATE_LIMITED",
        message: "Слишком много попыток оплаты. Повторите позже.",
        ok: false as const,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }

    try {
      assertRequestSize(request, FORM_MAXIMUM_BYTES);
      const formData = await request.formData();
      assertFormPayloadSize(formData, FORM_MAXIMUM_BYTES);
      const input = parsePurchaseInput(formData);
      const { database } = await getDatabase();
      const invoice = await createOrderInvoice(
        database,
        getTelegramStarsPayments(config),
        user.id,
        input,
      );

      return {
        action: "purchase",
        invoiceUrl: invoice.invoiceUrl,
        message: "Счёт создан. Подтвердите оплату в Telegram.",
        ok: true as const,
        orderId: invoice.orderId,
      };
    } catch (error) {
      return actionError(
        "purchase",
        error,
        "Не удалось создать счёт. Попробуйте ещё раз.",
      );
    }
  },
  applyPromo: async ({ getClientAddress, locals, request }) => {
    const user = locals.user;

    if (!user) {
      return fail(401, {
        action: "promo",
        code: "AUTH_REQUIRED",
        message: "Сначала войдите через Telegram.",
        ok: false as const,
      });
    }

    const rateLimit = consumeRateLimit(
      `promo:${user.id}:${getClientAddress()}`,
      PROMO_RATE_LIMIT,
      PROMO_RATE_LIMIT_WINDOW_SECONDS,
    );

    if (!rateLimit.allowed) {
      return fail(429, {
        action: "promo",
        code: "PROMO_RATE_LIMITED",
        message: "Слишком много попыток. Повторите позже.",
        ok: false as const,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }

    try {
      assertRequestSize(request, FORM_MAXIMUM_BYTES);
      const formData = await request.formData();
      assertFormPayloadSize(formData, FORM_MAXIMUM_BYTES);
      const input = parsePromoApplication(formData);
      const { database } = await getDatabase();
      const promoCode = await validatePromoCode(database, user.id, input.code);

      return {
        action: "promo",
        message:
          promoCode.discountType === "percent"
            ? `Промокод применён: скидка ${promoCode.discountValue}%.`
            : `Промокод применён: скидка ${promoCode.discountValue} Stars.`,
        ok: true as const,
        promoCode,
      };
    } catch (error) {
      return actionError(
        "promo",
        error,
        "Не удалось проверить промокод. Попробуйте ещё раз.",
      );
    }
  },
  createTicket: async ({ getClientAddress, locals, request }) => {
    const user = locals.user;

    if (!user) {
      return fail(401, {
        action: "support",
        code: "AUTH_REQUIRED",
        message: "Сначала войдите через Telegram.",
        ok: false as const,
      });
    }

    const rateLimit = consumeRateLimit(
      `support:${user.id}:${getClientAddress()}`,
      SUPPORT_RATE_LIMIT,
      SUPPORT_RATE_LIMIT_WINDOW_SECONDS,
    );

    if (!rateLimit.allowed) {
      return fail(429, {
        action: "support",
        code: "SUPPORT_RATE_LIMITED",
        message: "Слишком много обращений. Повторите позже.",
        ok: false as const,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }

    try {
      assertRequestSize(request, FORM_MAXIMUM_BYTES);
      const formData = await request.formData();
      assertFormPayloadSize(formData, FORM_MAXIMUM_BYTES);
      const input = parseSupportTicketInput(formData);
      const config = getRuntimeConfig();
      const notifier =
        config.telegramBotToken && config.telegramAdminUserId
          ? new TelegramSupportNotifier(
              config.telegramBotToken,
              config.telegramAdminUserId,
            )
          : new UnavailableSupportNotifier();
      const { database } = await getDatabase();
      const ticket = await createSupportTicket(database, notifier, input, user);

      return {
        action: "support",
        message: `Обращение ${ticket.publicNumber} принято.`,
        ok: true as const,
        publicNumber: ticket.publicNumber,
      };
    } catch (error) {
      return actionError(
        "support",
        error,
        "Не удалось сохранить обращение. Попробуйте ещё раз.",
      );
    }
  },
  logout: async ({ cookies }) => {
    const config = getRuntimeConfig();
    const token = cookies.get(getSessionCookieName(config));

    if (token) {
      const { database } = await getDatabase();
      await revokeSession(database, token, config.sessionSecret);
    }

    deleteSessionCookie(cookies, config);
    redirect(303, "/");
  },
} satisfies Actions;

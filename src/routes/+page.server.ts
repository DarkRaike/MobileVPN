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
import {
  TelegramSupportNotifier,
  UnavailableSupportNotifier,
} from "$lib/server/integrations/telegram/support-notifier";
import {
  listActivePlans,
  listPublishedFaq,
  validatePromoCode,
} from "$lib/server/modules/catalog/catalog";
import { createSupportTicket } from "$lib/server/modules/support/support";
import { consumeRateLimit } from "$lib/server/security/rate-limit";
import {
  assertFormPayloadSize,
  assertRequestSize,
  isValidationError,
  parsePromoApplication,
  parseSupportTicketInput,
} from "$lib/server/validation/forms";

import type { Actions, PageServerLoad } from "./$types";

const FORM_MAXIMUM_BYTES = 16 * 1024;
const PROMO_RATE_LIMIT = 15;
const PROMO_RATE_LIMIT_WINDOW_SECONDS = 60;
const SUPPORT_RATE_LIMIT = 5;
const SUPPORT_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

function actionError(
  action: "promo" | "support",
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

  console.error(
    JSON.stringify({
      errorCode:
        action === "support"
          ? "SUPPORT_CREATE_FAILED"
          : "PROMO_VALIDATE_FAILED",
      errorType: error instanceof Error ? error.name : "UnknownError",
      level: "error",
      timestamp: new Date().toISOString(),
    }),
  );

  return fail(500, {
    action,
    code: "INTERNAL_ERROR",
    message: fallbackMessage,
    ok: false as const,
  });
}

export const load: PageServerLoad = async ({ locals }) => {
  const config = getRuntimeConfig();
  let activePlans: Awaited<ReturnType<typeof listActivePlans>> = [];
  let faqItems: Awaited<ReturnType<typeof listPublishedFaq>> = [];

  if (locals.user) {
    const { database } = await getDatabase();
    [activePlans, faqItems] = await Promise.all([
      listActivePlans(database),
      listPublishedFaq(database),
    ]);
  }

  return {
    activePlans,
    developmentMockAuthEnabled: config.developmentMock.enabled,
    faqItems,
    isAdmin: isAdminUser(locals.user, config.telegramAdminUserId),
    sessionExpiresAt: locals.session?.expiresAt ?? null,
    user: locals.user,
  };
};

export const actions = {
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

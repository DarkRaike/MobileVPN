import { Buffer } from "node:buffer";

import { json, type RequestHandler } from "@sveltejs/kit";
import { z } from "zod";

import {
  deleteSessionCookie,
  getSessionCookieName,
  setSessionCookie,
} from "$lib/server/auth/cookies";
import { createSession, revokeSession } from "$lib/server/auth/sessions";
import {
  TelegramAuthError,
  type TelegramUser,
  validateTelegramInitData,
} from "$lib/server/auth/telegram";
import { upsertTelegramUser } from "$lib/server/auth/users";
import { getRuntimeConfig } from "$lib/server/config/runtime";
import { getDatabase } from "$lib/server/db/runtime";
import { logEvent } from "$lib/server/observability/logger";
import { consumeRateLimit } from "$lib/server/security/rate-limit";

const requestSchema = z
  .object({
    initData: z.string().max(8192),
  })
  .strict();

const MAX_REQUEST_BYTES = 16 * 1024;
const AUTH_RATE_LIMIT = 10;
const AUTH_RATE_LIMIT_WINDOW_SECONDS = 60;

function errorResponse(
  code: string,
  message: string,
  status: number,
  retryAfterSeconds?: number,
): Response {
  const response = json(
    {
      error: {
        code,
        message,
      },
      ok: false,
    },
    { status },
  );

  response.headers.set("Cache-Control", "no-store");

  if (retryAfterSeconds) {
    response.headers.set("Retry-After", String(retryAfterSeconds));
  }

  return response;
}

function assertSameOrigin(request: Request, expectedOrigin: string): void {
  const origin = request.headers.get("origin");

  if (!origin || origin !== expectedOrigin) {
    throw new Error("ORIGIN_MISMATCH");
  }
}

async function readRequest(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new Error("UNSUPPORTED_CONTENT_TYPE");
  }

  if (
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > MAX_REQUEST_BYTES
  ) {
    throw new Error("REQUEST_TOO_LARGE");
  }

  const body = await request.text();

  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
    throw new Error("REQUEST_TOO_LARGE");
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function getDevelopmentMockUser(): TelegramUser {
  const { developmentMock } = getRuntimeConfig();

  return {
    firstName: developmentMock.firstName,
    id: developmentMock.telegramUserId,
    lastName: developmentMock.lastName,
    username: developmentMock.username,
  };
}

export const POST: RequestHandler = async ({
  cookies,
  getClientAddress,
  request,
  url,
}) => {
  const config = getRuntimeConfig();
  const expectedOrigin = config.origin
    ? new URL(config.origin).origin
    : url.origin;

  try {
    assertSameOrigin(request, expectedOrigin);
  } catch {
    return errorResponse(
      "AUTH_ORIGIN_INVALID",
      "Запрос авторизации отклонён.",
      403,
    );
  }

  const rateLimit = consumeRateLimit(
    `telegram-auth:${getClientAddress()}`,
    AUTH_RATE_LIMIT,
    AUTH_RATE_LIMIT_WINDOW_SECONDS,
  );

  if (!rateLimit.allowed) {
    return errorResponse(
      "AUTH_RATE_LIMITED",
      "Слишком много попыток. Повторите позже.",
      429,
      rateLimit.retryAfterSeconds,
    );
  }

  let payload: z.infer<typeof requestSchema>;

  try {
    payload = requestSchema.parse(await readRequest(request));
  } catch (error) {
    const status =
      error instanceof Error && error.message === "REQUEST_TOO_LARGE"
        ? 413
        : 400;
    return errorResponse(
      "AUTH_REQUEST_INVALID",
      "Некорректный запрос авторизации.",
      status,
    );
  }

  const now = new Date();
  let telegramUser: TelegramUser;

  if (payload.initData) {
    if (!config.telegramBotToken) {
      throw new Error("Telegram bot token is unavailable");
    }

    try {
      telegramUser = validateTelegramInitData(
        payload.initData,
        config.telegramBotToken,
        config.telegramInitDataMaxAgeSeconds,
        now,
      ).user;
    } catch (error) {
      if (error instanceof TelegramAuthError) {
        // The reason narrows down a rejected sign-in without exposing it to the
        // browser or writing any part of the init data to the log.
        logEvent("warn", {
          errorCode: error.code,
          reason: error.reason,
          route: "/api/auth/telegram",
        });
        deleteSessionCookie(cookies, config);
        return errorResponse(
          error.code,
          error.code === "AUTH_INIT_DATA_EXPIRED"
            ? "Данные Telegram устарели. Откройте приложение заново."
            : "Не удалось подтвердить данные Telegram.",
          401,
        );
      }

      throw error;
    }
  } else if (config.developmentMock.enabled) {
    telegramUser = getDevelopmentMockUser();
  } else {
    return errorResponse(
      "AUTH_INIT_DATA_INVALID",
      "Откройте приложение из Telegram.",
      401,
    );
  }

  const { database } = await getDatabase();
  const user = await upsertTelegramUser(database, telegramUser, now);
  const previousToken = cookies.get(getSessionCookieName(config));
  const session = await createSession(
    database,
    user.id,
    config.sessionSecret,
    now,
  );

  if (previousToken) {
    await revokeSession(database, previousToken, config.sessionSecret, now);
  }

  setSessionCookie(cookies, session.token, session.expiresAt, config);

  const response = json({ ok: true });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

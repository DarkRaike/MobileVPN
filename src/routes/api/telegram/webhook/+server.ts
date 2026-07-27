import { json } from "@sveltejs/kit";
import { ZodError } from "zod";

import { ApplicationError } from "$lib/server/application-error";
import { getRuntimeConfig } from "$lib/server/config/runtime";
import { getDatabase } from "$lib/server/db/runtime";
import { getTelegramStarsPayments } from "$lib/server/integrations/payments/runtime";
import { verifyTelegramWebhookSecret } from "$lib/server/integrations/payments/telegram-stars";
import { logEvent } from "$lib/server/observability/logger";
import {
  parseTelegramPaymentUpdate,
  processTelegramPaymentUpdate,
} from "$lib/server/modules/payments/webhook";
import { consumeRateLimit } from "$lib/server/security/rate-limit";

import type { RequestHandler } from "./$types";

const MAXIMUM_BODY_BYTES = 64 * 1_024;
const WEBHOOK_RATE_LIMIT = 120;
const WEBHOOK_RATE_LIMIT_WINDOW_SECONDS = 60;

function rateLimitedResponse(retryAfterSeconds: number): Response {
  const response = json({ ok: false }, { status: 429 });
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

async function readLimitedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();

  if (!reader) {
    throw new ApplicationError("WEBHOOK_BODY_INVALID", "Request body required");
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > MAXIMUM_BODY_BYTES) {
      await reader.cancel();
      throw new ApplicationError("REQUEST_TOO_LARGE", "Request body too large");
    }

    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder().decode(body));
}

export const POST: RequestHandler = async ({ getClientAddress, request }) => {
  const config = getRuntimeConfig();

  if (!config.liveOperationsEnabled || !config.telegramWebhookSecret) {
    return json({ ok: false }, { status: 503 });
  }

  const rateLimit = consumeRateLimit(
    `telegram-webhook:${getClientAddress()}`,
    WEBHOOK_RATE_LIMIT,
    WEBHOOK_RATE_LIMIT_WINDOW_SECONDS,
  );

  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit.retryAfterSeconds);
  }

  if (
    !verifyTelegramWebhookSecret(
      request.headers.get("x-telegram-bot-api-secret-token"),
      config.telegramWebhookSecret,
    )
  ) {
    return json({ ok: false }, { status: 401 });
  }

  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (!contentType.toLowerCase().startsWith("application/json")) {
      return json({ ok: false }, { status: 415 });
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");

    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > MAXIMUM_BODY_BYTES
    ) {
      return json({ ok: false }, { status: 413 });
    }

    const update = parseTelegramPaymentUpdate(await readLimitedJson(request));
    const { database } = await getDatabase();
    const paymentAdapter = getTelegramStarsPayments(config);

    await processTelegramPaymentUpdate(database, paymentAdapter, update);

    return json({ ok: true });
  } catch (error) {
    const status =
      error instanceof ApplicationError && error.code === "REQUEST_TOO_LARGE"
        ? 413
        : error instanceof SyntaxError ||
            error instanceof TypeError ||
            error instanceof ZodError
          ? 400
          : 500;

    logEvent("error", {
      errorCode:
        error instanceof ApplicationError
          ? error.code
          : "TELEGRAM_WEBHOOK_FAILED",
      errorType: error instanceof Error ? error.name : "UnknownError",
      route: "/api/telegram/webhook",
    });

    return json({ ok: false }, { status });
  }
};

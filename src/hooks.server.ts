import { randomUUID } from "node:crypto";

import type { Handle, HandleServerError } from "@sveltejs/kit";

import {
  deleteSessionCookie,
  getSessionCookieName,
} from "$lib/server/auth/cookies";
import { validateSession } from "$lib/server/auth/sessions";
import { getRuntimeConfig } from "$lib/server/config/runtime";
import { getDatabase } from "$lib/server/db/runtime";
import { logEvent } from "$lib/server/observability/logger";
import { recordRequestOutcome } from "$lib/server/observability/metrics";
import { applySecurityHeaders } from "$lib/server/security/headers";

export const handle: Handle = async ({ event, resolve }) => {
  const config = getRuntimeConfig();
  const requestId = randomUUID();
  const startedAt = Date.now();

  event.locals.session = null;
  event.locals.user = null;
  event.locals.requestId = requestId;

  try {
    const token = event.cookies.get(getSessionCookieName(config));

    if (token) {
      const { database } = await getDatabase();
      const session = await validateSession(
        database,
        token,
        config.sessionSecret,
      );

      if (session) {
        event.locals.session = session;
        event.locals.user = session.user;
      } else {
        deleteSessionCookie(event.cookies, config);
      }
    }

    const response = await resolve(event);
    recordRequestOutcome(event.url.pathname, response.status);

    applySecurityHeaders(response.headers, config.isProduction);
    response.headers.set("X-Request-Id", requestId);

    if (
      !event.url.pathname.startsWith("/_app/") &&
      !response.headers.has("Cache-Control")
    ) {
      response.headers.set("Cache-Control", "private, no-store");
    }

    if (!event.url.pathname.startsWith("/_app/")) {
      logEvent(response.status >= 500 ? "error" : "info", {
        durationMilliseconds: Date.now() - startedAt,
        method: event.request.method,
        requestId,
        route: event.route.id ?? "unmatched",
        status: response.status,
        userId: event.locals.user?.id,
      });
    }

    return response;
  } catch (error) {
    recordRequestOutcome(event.url.pathname, 500);
    logEvent("error", {
      durationMilliseconds: Date.now() - startedAt,
      errorCode: "REQUEST_FAILED",
      errorType: error instanceof Error ? error.name : "UnknownError",
      method: event.request.method,
      requestId,
      route: event.route.id ?? "unmatched",
      userId: event.locals.user?.id,
    });
    throw error;
  }
};

export const handleError: HandleServerError = ({ error, event }) => {
  const correlationId = event.locals.requestId || randomUUID();

  logEvent("error", {
    correlationId,
    errorCode: "UNHANDLED_ERROR",
    errorType: error instanceof Error ? error.name : "UnknownError",
    route: event.route.id,
  });

  return {
    code: "INTERNAL_ERROR",
    message: "Не удалось выполнить запрос. Попробуйте ещё раз.",
  };
};

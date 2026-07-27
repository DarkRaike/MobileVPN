import { randomUUID } from "node:crypto";

import type { Handle, HandleServerError } from "@sveltejs/kit";

import {
  deleteSessionCookie,
  getSessionCookieName,
} from "$lib/server/auth/cookies";
import { validateSession } from "$lib/server/auth/sessions";
import { getRuntimeConfig } from "$lib/server/config/runtime";
import { getDatabase } from "$lib/server/db/runtime";

export const handle: Handle = async ({ event, resolve }) => {
  const config = getRuntimeConfig();
  const requestId = randomUUID();

  event.locals.session = null;
  event.locals.user = null;

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

  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=()",
  );
  response.headers.set("X-Request-Id", requestId);

  if (
    !event.url.pathname.startsWith("/_app/") &&
    !response.headers.has("Cache-Control")
  ) {
    response.headers.set("Cache-Control", "private, no-store");
  }

  if (config.isProduction) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  return response;
};

export const handleError: HandleServerError = ({ error, event }) => {
  const correlationId = randomUUID();

  console.error(
    JSON.stringify({
      correlationId,
      errorCode: "UNHANDLED_ERROR",
      errorType: error instanceof Error ? error.name : "UnknownError",
      level: "error",
      route: event.route.id,
      timestamp: new Date().toISOString(),
    }),
  );

  return {
    code: "INTERNAL_ERROR",
    message: "Не удалось выполнить запрос. Попробуйте ещё раз.",
  };
};

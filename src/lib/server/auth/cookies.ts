import type { Cookies } from "@sveltejs/kit";

import type { RuntimeConfig } from "../config/schema";
import { SESSION_ABSOLUTE_TTL_SECONDS } from "./sessions";

const DEVELOPMENT_COOKIE_NAME = "astra_session";
const PRODUCTION_COOKIE_NAME = "__Host-astra_session";

export function getSessionCookieName(config: RuntimeConfig): string {
  return config.isProduction ? PRODUCTION_COOKIE_NAME : DEVELOPMENT_COOKIE_NAME;
}

export function setSessionCookie(
  cookies: Cookies,
  token: string,
  expiresAt: Date,
  config: RuntimeConfig,
): void {
  cookies.set(getSessionCookieName(config), token, {
    expires: expiresAt,
    httpOnly: true,
    maxAge: SESSION_ABSOLUTE_TTL_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: config.isProduction,
  });
}

export function deleteSessionCookie(
  cookies: Cookies,
  config: RuntimeConfig,
): void {
  cookies.delete(getSessionCookieName(config), {
    path: "/",
    sameSite: "lax",
    secure: config.isProduction,
  });
}

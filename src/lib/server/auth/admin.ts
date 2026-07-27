import { error } from "@sveltejs/kit";

import type { AuthenticatedUser } from "./sessions";

export function isAdminUser(
  user: AuthenticatedUser | null,
  telegramAdminUserId: string | undefined,
): boolean {
  return Boolean(
    user && telegramAdminUserId && user.telegramUserId === telegramAdminUserId,
  );
}

export function requireAdminUser(
  user: AuthenticatedUser | null,
  telegramAdminUserId: string | undefined,
): AuthenticatedUser {
  if (!user) {
    error(401, {
      code: "ADMIN_AUTH_REQUIRED",
      message: "Для доступа требуется авторизация.",
    });
  }

  if (!isAdminUser(user, telegramAdminUserId)) {
    error(403, {
      code: "ADMIN_ACCESS_DENIED",
      message: "Доступ к административному разделу запрещён.",
    });
  }

  return user;
}

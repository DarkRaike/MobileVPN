import { redirect } from "@sveltejs/kit";

import {
  deleteSessionCookie,
  getSessionCookieName,
} from "$lib/server/auth/cookies";
import { revokeSession } from "$lib/server/auth/sessions";
import { getRuntimeConfig } from "$lib/server/config/runtime";
import { getDatabase } from "$lib/server/db/runtime";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  const config = getRuntimeConfig();

  return {
    developmentMockAuthEnabled: config.developmentMock.enabled,
    sessionExpiresAt: locals.session?.expiresAt ?? null,
    user: locals.user,
  };
};

export const actions = {
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

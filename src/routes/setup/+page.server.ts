import { getRuntimeConfig } from "$lib/server/config/runtime";
import { getDatabase } from "$lib/server/db/runtime";
import { getProfileOverview } from "$lib/server/modules/subscriptions/profile";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const config = getRuntimeConfig();
  const profileOverview = {
    purchaseHistory: [],
    subscription: { status: "none" as const },
  };

  if (!locals.user) {
    return {
      developmentMockAuthEnabled: config.developmentMock.enabled,
      profileOverview,
      user: null,
    };
  }

  const { database } = await getDatabase();

  return {
    developmentMockAuthEnabled: config.developmentMock.enabled,
    profileOverview: await getProfileOverview(
      database,
      locals.user.id,
      config.subscriptionUrlEncryptionKey,
    ),
    user: locals.user,
  };
};

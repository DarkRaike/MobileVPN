import { json, type RequestHandler } from "@sveltejs/kit";

import { getDatabase } from "$lib/server/db/runtime";

export const GET: RequestHandler = async () => {
  try {
    const { client } = await getDatabase();
    await client.execute("SELECT 1 FROM users LIMIT 1");

    return json(
      {
        status: "ok",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return json(
      {
        status: "unavailable",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
        status: 503,
      },
    );
  }
};

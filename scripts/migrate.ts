import "dotenv/config";

import { createDatabase } from "../src/lib/server/db/client";
import { migrateDatabase } from "../src/lib/server/db/migrate";

const context = await createDatabase(
  process.env.DATABASE_URL ?? "./data/astra-vpn.sqlite",
);

try {
  await migrateDatabase(context);
  console.info("Database migrations applied.");
} finally {
  context.close();
}

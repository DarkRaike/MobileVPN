import { createDatabase } from "../src/lib/server/db/client";
import { migrateDatabase } from "../src/lib/server/db/migrate";
import { seedInitialCatalog } from "../src/lib/server/modules/catalog/seed";
import { parseRuntimeConfig } from "../src/lib/server/config/schema";

const config = parseRuntimeConfig(process.env);
const context = await createDatabase(config.databaseUrl);

try {
  await migrateDatabase(context);
  await seedInitialCatalog(context.database);
  console.info("Initial catalog seed completed.");
} finally {
  context.close();
}

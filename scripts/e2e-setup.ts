import { rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { createDatabase } from "../src/lib/server/db/client";
import { migrateDatabase } from "../src/lib/server/db/migrate";
import { promoCodes } from "../src/lib/server/db/schema";
import { seedInitialCatalog } from "../src/lib/server/modules/catalog/seed";

const configuredPath = process.env.DATABASE_URL;

if (!configuredPath) {
  throw new Error("DATABASE_URL is required for E2E setup");
}

const databasePath = resolve(configuredPath);
const allowedDirectory = resolve("data");

if (
  dirname(databasePath) !== allowedDirectory ||
  !basename(databasePath).startsWith("e2e.")
) {
  throw new Error(
    "E2E database must be an e2e.* file inside the data directory",
  );
}

for (const suffix of ["", "-shm", "-wal"]) {
  rmSync(`${databasePath}${suffix}`, { force: true });
}

const context = await createDatabase(databasePath);

try {
  await migrateDatabase(context);
  await seedInitialCatalog(context.database);
  await context.database.insert(promoCodes).values({
    codeNormalized: "E2E20",
    currency: null,
    discountType: "percent",
    discountValue: 20,
    id: "00000000-0000-4000-8000-000000002020",
    isActive: true,
  });
  console.info(
    JSON.stringify({
      database: basename(databasePath),
      event: "E2E_DATABASE_READY",
    }),
  );
} finally {
  context.close();
}

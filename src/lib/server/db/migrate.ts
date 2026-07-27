import { resolve } from "node:path";

import { migrate } from "drizzle-orm/libsql/migrator";

import type { DatabaseContext } from "./client";

export async function migrateDatabase(
  context: DatabaseContext,
  migrationsFolder = resolve(process.cwd(), "drizzle"),
): Promise<void> {
  await migrate(context.database, { migrationsFolder });
}

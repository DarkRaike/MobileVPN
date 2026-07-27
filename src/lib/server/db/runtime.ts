import type { DatabaseContext } from "./client";
import { createDatabase } from "./client";
import { migrateDatabase } from "./migrate";
import { getRuntimeConfig } from "../config/runtime";

let databaseContextPromise: Promise<DatabaseContext> | undefined;

export function getDatabase(): Promise<DatabaseContext> {
  databaseContextPromise ??= createDatabase(
    getRuntimeConfig().databaseUrl,
  ).then(async (context) => {
    try {
      await migrateDatabase(context);
      return context;
    } catch (error) {
      context.close();
      databaseContextPromise = undefined;
      throw error;
    }
  });

  return databaseContextPromise;
}

import type { DatabaseContext } from "./client";
import { createDatabase } from "./client";
import { getRuntimeConfig } from "../config/runtime";

let databaseContextPromise: Promise<DatabaseContext> | undefined;

export function getDatabase(): Promise<DatabaseContext> {
  databaseContextPromise ??= createDatabase(getRuntimeConfig().databaseUrl);
  return databaseContextPromise;
}

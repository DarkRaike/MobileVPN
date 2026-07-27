import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient, type Client } from "@libsql/client/node";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import * as schema from "./schema";

export interface DatabaseContext {
  client: Client;
  database: LibSQLDatabase<typeof schema>;
  close(): void;
}

function normalizeDatabasePath(databaseUrl: string): string {
  const value = databaseUrl.trim();

  if (!value) {
    throw new Error("DATABASE_URL is required");
  }

  if (value === ":memory:") {
    return value;
  }

  if (value.startsWith("file:")) {
    return fileURLToPath(value);
  }

  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function toLibSqlUrl(databasePath: string): string {
  if (databasePath === ":memory:") {
    return databasePath;
  }

  return `file:${databasePath.replaceAll("\\", "/")}`;
}

export async function createDatabase(
  databaseUrl: string,
): Promise<DatabaseContext> {
  const databasePath = normalizeDatabasePath(databaseUrl);

  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const client = createClient({
    intMode: "number",
    url: toLibSqlUrl(databasePath),
  });

  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("PRAGMA busy_timeout = 5000");
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA synchronous = NORMAL");

  return {
    client,
    database: drizzle({ client, schema }),
    close: () => client.close(),
  };
}

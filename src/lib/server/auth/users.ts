import { randomUUID } from "node:crypto";

import type { LibSQLDatabase } from "drizzle-orm/libsql";

import type { TelegramUser } from "./telegram";
import * as schema from "../db/schema";

export async function upsertTelegramUser(
  database: LibSQLDatabase<typeof schema>,
  telegramUser: TelegramUser,
  authenticatedAt: Date,
): Promise<schema.UserRecord> {
  const records = await database
    .insert(schema.users)
    .values({
      id: randomUUID(),
      firstName: telegramUser.firstName,
      languageCode: telegramUser.languageCode ?? null,
      lastAuthenticatedAt: authenticatedAt,
      lastName: telegramUser.lastName ?? null,
      photoUrl: telegramUser.photoUrl ?? null,
      telegramUserId: telegramUser.id,
      updatedAt: authenticatedAt,
      username: telegramUser.username ?? null,
    })
    .onConflictDoUpdate({
      target: schema.users.telegramUserId,
      set: {
        firstName: telegramUser.firstName,
        languageCode: telegramUser.languageCode ?? null,
        lastAuthenticatedAt: authenticatedAt,
        lastName: telegramUser.lastName ?? null,
        photoUrl: telegramUser.photoUrl ?? null,
        updatedAt: authenticatedAt,
        username: telegramUser.username ?? null,
      },
    })
    .returning();

  const user = records[0];

  if (!user) {
    throw new Error("User upsert returned no record");
  }

  return user;
}

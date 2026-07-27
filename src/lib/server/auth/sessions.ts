import { createHmac, randomBytes } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import * as schema from "../db/schema";

export const SESSION_ABSOLUTE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_IDLE_TTL_SECONDS = 24 * 60 * 60;

const SESSION_TOUCH_INTERVAL_SECONDS = 5 * 60;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface AuthenticatedUser {
  firstName: string;
  id: string;
  languageCode: string | null;
  lastName: string | null;
  photoUrl: string | null;
  telegramUserId: string;
  username: string | null;
}

export interface AuthenticatedSession {
  expiresAt: Date;
  user: AuthenticatedUser;
}

export interface NewSession {
  expiresAt: Date;
  token: string;
}

export function isSessionToken(value: string): boolean {
  return SESSION_TOKEN_PATTERN.test(value);
}

export function hashSessionToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export async function createSession(
  database: LibSQLDatabase<typeof schema>,
  userId: string,
  secret: string,
  now = new Date(),
): Promise<NewSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    now.getTime() + SESSION_ABSOLUTE_TTL_SECONDS * 1000,
  );

  await database.insert(schema.sessions).values({
    expiresAt,
    idHash: hashSessionToken(token, secret),
    lastSeenAt: now,
    userId,
  });

  return { expiresAt, token };
}

export async function revokeSession(
  database: LibSQLDatabase<typeof schema>,
  token: string,
  secret: string,
  now = new Date(),
): Promise<void> {
  if (!isSessionToken(token)) {
    return;
  }

  await database
    .update(schema.sessions)
    .set({
      revokedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.sessions.idHash, hashSessionToken(token, secret)),
        isNull(schema.sessions.revokedAt),
      ),
    );
}

export async function validateSession(
  database: LibSQLDatabase<typeof schema>,
  token: string,
  secret: string,
  now = new Date(),
): Promise<AuthenticatedSession | null> {
  if (!isSessionToken(token)) {
    return null;
  }

  const idHash = hashSessionToken(token, secret);
  const records = await database
    .select({
      expiresAt: schema.sessions.expiresAt,
      lastSeenAt: schema.sessions.lastSeenAt,
      user: {
        firstName: schema.users.firstName,
        id: schema.users.id,
        languageCode: schema.users.languageCode,
        lastName: schema.users.lastName,
        photoUrl: schema.users.photoUrl,
        telegramUserId: schema.users.telegramUserId,
        username: schema.users.username,
      },
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(
      and(
        eq(schema.sessions.idHash, idHash),
        isNull(schema.sessions.revokedAt),
      ),
    )
    .limit(1);

  const session = records[0];

  if (!session) {
    return null;
  }

  const idleExpiresAt =
    session.lastSeenAt.getTime() + SESSION_IDLE_TTL_SECONDS * 1000;

  if (
    session.expiresAt.getTime() <= now.getTime() ||
    idleExpiresAt <= now.getTime()
  ) {
    await database
      .update(schema.sessions)
      .set({
        revokedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.sessions.idHash, idHash));
    return null;
  }

  if (
    now.getTime() - session.lastSeenAt.getTime() >=
    SESSION_TOUCH_INTERVAL_SECONDS * 1000
  ) {
    await database
      .update(schema.sessions)
      .set({
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.sessions.idHash, idHash),
          isNull(schema.sessions.revokedAt),
        ),
      );
  }

  return {
    expiresAt: session.expiresAt,
    user: session.user,
  };
}

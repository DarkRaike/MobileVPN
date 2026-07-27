import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSession,
  revokeSession,
  SESSION_IDLE_TTL_SECONDS,
  validateSession,
} from "../../src/lib/server/auth/sessions";
import {
  createDatabase,
  type DatabaseContext,
} from "../../src/lib/server/db/client";
import { migrateDatabase } from "../../src/lib/server/db/migrate";
import { sessions, users } from "../../src/lib/server/db/schema";

const SESSION_SECRET = "test-session-secret-with-at-least-32-chars";
const NOW = new Date("2026-07-27T12:00:00.000Z");

describe("sessions", () => {
  let context: DatabaseContext;
  let userId: string;

  beforeEach(async () => {
    context = await createDatabase(":memory:");
    await migrateDatabase(context);
    userId = randomUUID();

    await context.database.insert(users).values({
      id: userId,
      firstName: "Daniil",
      lastAuthenticatedAt: NOW,
      telegramUserId: "123456789",
    });
  });

  afterEach(() => {
    context.close();
  });

  it("stores only an HMAC hash and validates the session owner", async () => {
    const session = await createSession(
      context.database,
      userId,
      SESSION_SECRET,
      NOW,
    );
    const storedSessions = await context.database.select().from(sessions);

    expect(storedSessions[0]?.idHash).toHaveLength(64);
    expect(storedSessions[0]?.idHash).not.toContain(session.token);

    const validated = await validateSession(
      context.database,
      session.token,
      SESSION_SECRET,
      NOW,
    );
    expect(validated?.user.telegramUserId).toBe("123456789");
  });

  it("revokes a session explicitly", async () => {
    const session = await createSession(
      context.database,
      userId,
      SESSION_SECRET,
      NOW,
    );

    await revokeSession(context.database, session.token, SESSION_SECRET, NOW);

    await expect(
      validateSession(context.database, session.token, SESSION_SECRET, NOW),
    ).resolves.toBeNull();
  });

  it("revokes a session after the idle timeout", async () => {
    const createdAt = new Date(
      NOW.getTime() - (SESSION_IDLE_TTL_SECONDS + 1) * 1000,
    );
    const session = await createSession(
      context.database,
      userId,
      SESSION_SECRET,
      createdAt,
    );

    await expect(
      validateSession(context.database, session.token, SESSION_SECRET, NOW),
    ).resolves.toBeNull();

    const storedSessions = await context.database.select().from(sessions);
    expect(storedSessions[0]?.revokedAt).toEqual(NOW);
  });
});

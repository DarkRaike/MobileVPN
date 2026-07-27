import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "../../src/lib/server/auth/sessions";
import {
  createDatabase,
  type DatabaseContext,
} from "../../src/lib/server/db/client";
import { migrateDatabase } from "../../src/lib/server/db/migrate";
import {
  adminAuditLog,
  supportTickets,
  users,
} from "../../src/lib/server/db/schema";
import type { SupportNotifier } from "../../src/lib/server/integrations/telegram/support-notifier";
import {
  createSupportTicket,
  updateSupportTicketStatus,
} from "../../src/lib/server/modules/support/support";

const NOW = new Date("2026-07-27T12:00:00.000Z");

describe("support tickets", () => {
  let context: DatabaseContext;
  let user: AuthenticatedUser;

  beforeAll(async () => {
    const dataDirectory = join(process.cwd(), "data");
    const databasePath = join(dataDirectory, "support-integration.sqlite");

    mkdirSync(dataDirectory, { recursive: true });

    for (const suffix of ["", "-shm", "-wal"]) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }

    context = await createDatabase(databasePath);
    await migrateDatabase(context);
  });

  beforeEach(async () => {
    await context.database.delete(adminAuditLog);
    await context.database.delete(supportTickets);
    await context.database.delete(users);

    user = {
      firstName: "Daniil",
      id: randomUUID(),
      languageCode: "ru",
      lastName: "Zhurik",
      photoUrl: null,
      telegramUserId: "123456789",
      username: "darkraike",
    };

    await context.database.insert(users).values({
      id: user.id,
      firstName: user.firstName,
      languageCode: user.languageCode,
      lastAuthenticatedAt: NOW,
      lastName: user.lastName,
      telegramUserId: user.telegramUserId,
      username: user.username,
    });
  });

  afterAll(() => {
    context.close();
  });

  it("keeps the ticket when Telegram delivery fails", async () => {
    const notifier: SupportNotifier = {
      sendTicketCreated: async () => {
        throw new Error("Telegram unavailable");
      },
    };
    const errorEvents: unknown[] = [];

    const result = await createSupportTicket(
      context.database,
      notifier,
      {
        message: "Не удаётся подключиться к серверу.",
        subject: "Проблема с подключением",
      },
      user,
      NOW,
      (event) => errorEvents.push(event),
    );
    const storedTickets = await context.database.select().from(supportTickets);

    expect(result.deliveryStatus).toBe("failed");
    expect(storedTickets).toHaveLength(1);
    expect(storedTickets[0]).toEqual(
      expect.objectContaining({
        message: "Не удаётся подключиться к серверу.",
        publicNumber: result.publicNumber,
        telegramDeliveryStatus: "failed",
      }),
    );
    expect(errorEvents).toEqual([
      expect.objectContaining({
        errorCode: "SUPPORT_NOTIFICATION_FAILED",
        ticketId: result.id,
      }),
    ]);
  });

  it("stores the Telegram message identifier after delivery", async () => {
    const notifier: SupportNotifier = {
      sendTicketCreated: async () => ({ messageId: "451" }),
    };

    const result = await createSupportTicket(
      context.database,
      notifier,
      {
        message: "Нужна помощь с настройкой приложения.",
        subject: "Другое",
      },
      user,
      NOW,
    );
    const storedTickets = await context.database.select().from(supportTickets);

    expect(result.deliveryStatus).toBe("sent");
    expect(storedTickets[0]).toEqual(
      expect.objectContaining({
        telegramDeliveryStatus: "sent",
        telegramMessageId: "451",
      }),
    );
  });

  it("audits status changes without copying ticket contents", async () => {
    const notifier: SupportNotifier = {
      sendTicketCreated: async () => ({ messageId: "452" }),
    };
    const ticket = await createSupportTicket(
      context.database,
      notifier,
      {
        message: "Секретный пользовательский текст.",
        subject: "Другое",
      },
      user,
      NOW,
    );

    const updated = await updateSupportTicketStatus(
      context.database,
      user.id,
      ticket.id,
      "resolved",
      NOW,
    );
    const auditRecords = await context.database.select().from(adminAuditLog);

    expect(updated.resolvedAt).toEqual(NOW);
    expect(auditRecords[0]?.afterJson).toBe(
      '{"status":"resolved","telegramDeliveryStatus":"sent"}',
    );
    expect(auditRecords[0]?.afterJson).not.toContain("Секретный");
  });
});

import { randomUUID } from "node:crypto";

import { asc, desc, eq } from "drizzle-orm";

import { ApplicationError } from "../../application-error";
import type { AuthenticatedUser } from "../../auth/sessions";
import type { Database } from "../../db/client";
import { adminAuditLog, supportTickets, users } from "../../db/schema";
import type { SupportNotifier } from "../../integrations/telegram/support-notifier";
import { createAuditRecord } from "../admin/audit";

export type SupportTicketStatus = "in_progress" | "new" | "resolved";

export interface SupportTicketInput {
  message: string;
  subject: string;
}

export interface SupportErrorEvent {
  errorCode: "SUPPORT_NOTIFICATION_FAILED";
  errorType: string;
  level: "error";
  ticketId: string;
  timestamp: string;
}

type SupportErrorLogger = (event: SupportErrorEvent) => void;

const defaultErrorLogger: SupportErrorLogger = (event) => {
  console.error(JSON.stringify(event));
};

function ticketStatusSnapshot(ticket: typeof supportTickets.$inferSelect) {
  return {
    status: ticket.status,
    telegramDeliveryStatus: ticket.telegramDeliveryStatus,
  };
}

function createPublicNumber(): string {
  return `AST-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createSupportTicket(
  database: Database,
  notifier: SupportNotifier,
  input: SupportTicketInput,
  user: AuthenticatedUser,
  now = new Date(),
  logError: SupportErrorLogger = defaultErrorLogger,
) {
  const id = randomUUID();
  const publicNumber = createPublicNumber();
  const records = await database
    .insert(supportTickets)
    .values({
      id,
      message: input.message,
      publicNumber,
      status: "new",
      subject: input.subject,
      telegramDeliveryStatus: "pending",
      userId: user.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const created = records[0];

  if (!created) {
    throw new Error("Support ticket insert returned no record");
  }

  try {
    const notification = await notifier.sendTicketCreated({
      createdAt: now,
      firstName: user.firstName,
      lastName: user.lastName,
      message: input.message,
      publicNumber,
      subject: input.subject,
      telegramUserId: user.telegramUserId,
      username: user.username,
    });

    await database
      .update(supportTickets)
      .set({
        telegramDeliveryStatus: "sent",
        telegramMessageId: notification.messageId,
        updatedAt: new Date(),
      })
      .where(eq(supportTickets.id, id));

    return {
      deliveryStatus: "sent" as const,
      id,
      publicNumber,
    };
  } catch (error) {
    await database
      .update(supportTickets)
      .set({
        telegramDeliveryStatus: "failed",
        updatedAt: new Date(),
      })
      .where(eq(supportTickets.id, id));

    logError({
      errorCode: "SUPPORT_NOTIFICATION_FAILED",
      errorType: error instanceof Error ? error.name : "UnknownError",
      level: "error",
      ticketId: id,
      timestamp: new Date().toISOString(),
    });

    return {
      deliveryStatus: "failed" as const,
      id,
      publicNumber,
    };
  }
}

export async function listSupportTickets(
  database: Database,
  status?: SupportTicketStatus,
) {
  const query = database
    .select({
      createdAt: supportTickets.createdAt,
      firstName: users.firstName,
      id: supportTickets.id,
      lastName: users.lastName,
      message: supportTickets.message,
      publicNumber: supportTickets.publicNumber,
      resolvedAt: supportTickets.resolvedAt,
      status: supportTickets.status,
      subject: supportTickets.subject,
      telegramDeliveryStatus: supportTickets.telegramDeliveryStatus,
      telegramMessageId: supportTickets.telegramMessageId,
      telegramUserId: users.telegramUserId,
      username: users.username,
    })
    .from(supportTickets)
    .innerJoin(users, eq(supportTickets.userId, users.id));

  return status
    ? query
        .where(eq(supportTickets.status, status))
        .orderBy(desc(supportTickets.createdAt))
    : query.orderBy(desc(supportTickets.createdAt));
}

export async function updateSupportTicketStatus(
  database: Database,
  adminUserId: string,
  ticketId: string,
  status: SupportTicketStatus,
  now = new Date(),
) {
  return database.transaction(async (transaction) => {
    const records = await transaction
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, ticketId))
      .limit(1);
    const before = records[0];

    if (!before) {
      throw new ApplicationError(
        "SUPPORT_TICKET_NOT_FOUND",
        "Обращение не найдено.",
      );
    }

    const updatedRecords = await transaction
      .update(supportTickets)
      .set({
        resolvedAt: status === "resolved" ? now : null,
        status,
        updatedAt: now,
      })
      .where(eq(supportTickets.id, ticketId))
      .returning();
    const updated = updatedRecords[0];

    if (!updated) {
      throw new Error("Support ticket update returned no record");
    }

    await transaction.insert(adminAuditLog).values(
      createAuditRecord({
        action: "support.status_update",
        adminUserId,
        after: ticketStatusSnapshot(updated),
        before: ticketStatusSnapshot(before),
        entityId: ticketId,
        entityType: "support_ticket",
        now,
      }),
    );

    return updated;
  });
}

export async function listAuditLog(database: Database, limit = 100) {
  return database
    .select({
      action: adminAuditLog.action,
      adminUserId: adminAuditLog.adminUserId,
      afterJson: adminAuditLog.afterJson,
      beforeJson: adminAuditLog.beforeJson,
      createdAt: adminAuditLog.createdAt,
      entityId: adminAuditLog.entityId,
      entityType: adminAuditLog.entityType,
      id: adminAuditLog.id,
    })
    .from(adminAuditLog)
    .orderBy(desc(adminAuditLog.createdAt), asc(adminAuditLog.id))
    .limit(Math.max(1, Math.min(limit, 200)));
}

import { randomUUID } from "node:crypto";

export interface AuditRecordInput {
  action: string;
  adminUserId: string;
  after?: unknown;
  before?: unknown;
  entityId: string;
  entityType: string;
  now?: Date;
}

function serializeSnapshot(snapshot: unknown): string | null {
  return snapshot === undefined ? null : JSON.stringify(snapshot);
}

export function createAuditRecord(input: AuditRecordInput) {
  return {
    action: input.action,
    adminUserId: input.adminUserId,
    afterJson: serializeSnapshot(input.after),
    beforeJson: serializeSnapshot(input.before),
    createdAt: input.now ?? new Date(),
    entityId: input.entityId,
    entityType: input.entityType,
    id: randomUUID(),
  };
}

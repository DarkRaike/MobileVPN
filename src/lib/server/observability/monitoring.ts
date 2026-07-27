import { readFile } from "node:fs/promises";

import type { Client } from "@libsql/client";
import { z } from "zod";

import { getRecentRequestMetrics } from "./metrics";

const BACKUP_STALE_AFTER_MILLISECONDS = 65 * 60 * 1_000;
const PAYMENT_STALE_AFTER_MILLISECONDS = 15 * 60 * 1_000;
const PROVISIONING_STALE_AFTER_MILLISECONDS = 10 * 60 * 1_000;
const SUPPORT_STALE_AFTER_MILLISECONDS = 5 * 60 * 1_000;

const backupStatusSchema = z.strictObject({
  lastAttemptAt: z.string().datetime(),
  lastErrorCode: z.string().max(128).optional(),
  lastSuccessAt: z.string().datetime().optional(),
  snapshotId: z.string().max(128).optional(),
  status: z.enum(["failed", "success"]),
});

export type OperationalStatus = "critical" | "ok" | "warning";

export interface OperationalSignal {
  id: string;
  status: OperationalStatus;
  threshold: number;
  value: number;
}

export interface MonitoringSnapshot {
  checkedAt: string;
  signals: OperationalSignal[];
  status: OperationalStatus;
}

function counterSignal(
  id: string,
  value: number,
  warningThreshold: number,
  criticalThreshold: number,
): OperationalSignal {
  const status =
    value >= criticalThreshold
      ? "critical"
      : value >= warningThreshold
        ? "warning"
        : "ok";

  return {
    id,
    status,
    threshold: warningThreshold,
    value,
  };
}

export function calculateOperationalStatus(
  signals: OperationalSignal[],
): OperationalStatus {
  if (signals.some((signal) => signal.status === "critical")) {
    return "critical";
  }

  return signals.some((signal) => signal.status === "warning")
    ? "warning"
    : "ok";
}

export function assessBackupStatus(
  value: unknown,
  now = new Date(),
): OperationalSignal {
  const parsed = backupStatusSchema.safeParse(value);

  if (!parsed.success || !parsed.data.lastSuccessAt) {
    return {
      id: "backup_freshness",
      status: "critical",
      threshold: 65,
      value: -1,
    };
  }

  const ageMinutes = Math.floor(
    (now.getTime() - new Date(parsed.data.lastSuccessAt).getTime()) / 60_000,
  );
  const status =
    ageMinutes > BACKUP_STALE_AFTER_MILLISECONDS / 60_000
      ? "critical"
      : parsed.data.status === "failed"
        ? "warning"
        : "ok";

  return {
    id: "backup_freshness",
    status,
    threshold: BACKUP_STALE_AFTER_MILLISECONDS / 60_000,
    value: Math.max(0, ageMinutes),
  };
}

async function readBackupSignal(
  backupStatusFile: string,
  now: Date,
): Promise<OperationalSignal> {
  try {
    return assessBackupStatus(
      JSON.parse(await readFile(backupStatusFile, "utf8")) as unknown,
      now,
    );
  } catch {
    return assessBackupStatus(null, now);
  }
}

async function count(
  client: Client,
  sql: string,
  arguments_: Array<number | string> = [],
): Promise<number> {
  const result = await client.execute({ args: arguments_, sql });
  return Number(result.rows[0]?.count ?? 0);
}

export async function collectMonitoringSnapshot(
  client: Client,
  backupStatusFile: string,
  now = new Date(),
): Promise<MonitoringSnapshot> {
  const nowMilliseconds = now.getTime();
  const requestMetrics = getRecentRequestMetrics(nowMilliseconds);
  const [
    stalePayments,
    paidWithoutSubscription,
    provisioningFailures,
    marzbanFailures,
    supportDeliveryFailures,
    backupSignal,
  ] = await Promise.all([
    count(
      client,
      "SELECT count(*) AS count FROM payments WHERE status = 'pending' AND created_at < ?",
      [nowMilliseconds - PAYMENT_STALE_AFTER_MILLISECONDS],
    ),
    count(
      client,
      `SELECT count(*) AS count
       FROM orders AS orders
       WHERE orders.status IN ('paid', 'provisioning', 'provisioning_failed')
         AND orders.updated_at < ?
         AND NOT EXISTS (
           SELECT 1
           FROM subscriptions AS subscriptions
           WHERE subscriptions.user_id = orders.user_id
             AND subscriptions.status = 'active'
             AND subscriptions.expires_at > ?
         )`,
      [
        nowMilliseconds - PROVISIONING_STALE_AFTER_MILLISECONDS,
        nowMilliseconds,
      ],
    ),
    count(
      client,
      "SELECT count(*) AS count FROM order_provisioning WHERE state = 'failed'",
    ),
    count(
      client,
      `SELECT count(*) AS count
       FROM order_provisioning
       WHERE state = 'failed' AND last_error_code LIKE 'MARZBAN_%'`,
    ),
    count(
      client,
      `SELECT count(*) AS count
       FROM support_tickets
       WHERE telegram_delivery_status = 'failed'
          OR (telegram_delivery_status = 'pending' AND created_at < ?)`,
      [nowMilliseconds - SUPPORT_STALE_AFTER_MILLISECONDS],
    ),
    readBackupSignal(backupStatusFile, now),
  ]);

  const signals = [
    counterSignal("application_5xx", requestMetrics.application5xx, 1, 5),
    counterSignal(
      "telegram_auth_failures",
      requestMetrics.telegramAuthFailures,
      5,
      10,
    ),
    counterSignal("stale_pending_payments", stalePayments, 1, 5),
    counterSignal("paid_without_subscription", paidWithoutSubscription, 1, 1),
    counterSignal("provisioning_failures", provisioningFailures, 1, 1),
    counterSignal("marzban_failures", marzbanFailures, 1, 1),
    counterSignal("support_delivery_failures", supportDeliveryFailures, 1, 5),
    backupSignal,
  ];

  return {
    checkedAt: now.toISOString(),
    signals,
    status: calculateOperationalStatus(signals),
  };
}

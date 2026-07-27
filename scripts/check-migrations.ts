import { strict as assert } from "node:assert";

import { createDatabase } from "../src/lib/server/db/client";
import { migrateDatabase } from "../src/lib/server/db/migrate";

const expectedTables = [
  "admin_audit_log",
  "faq_items",
  "order_provisioning",
  "orders",
  "payment_events",
  "payments",
  "plans",
  "promo_code_plans",
  "promo_codes",
  "refunds",
  "sessions",
  "subscriptions",
  "support_tickets",
  "users",
];

const context = await createDatabase(":memory:");

try {
  await migrateDatabase(context);
  await migrateDatabase(context);

  const tablesResult = await context.client.execute(
    `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE '\\_\\_%' ESCAPE '\\'
       ORDER BY name`,
  );
  const tables = tablesResult.rows
    .map((row) => String(row.name))
    .filter((name) => !name.startsWith("__drizzle"));

  assert.deepEqual(tables, expectedTables);

  const foreignKeys = await context.client.execute("PRAGMA foreign_keys");
  const journalMode = await context.client.execute("PRAGMA journal_mode");
  const integrity = await context.client.execute("PRAGMA integrity_check");
  const foreignKeyViolations = await context.client.execute(
    "PRAGMA foreign_key_check",
  );

  assert.equal(foreignKeys.rows[0]?.foreign_keys, 1);
  assert.equal(journalMode.rows[0]?.journal_mode, "memory");
  assert.equal(integrity.rows[0]?.integrity_check, "ok");
  assert.equal(foreignKeyViolations.rows.length, 0);

  console.info("Clean database migration check passed.");
} finally {
  context.close();
}

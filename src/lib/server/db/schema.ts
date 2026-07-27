import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const orderStatuses = [
  "pending_payment",
  "paid",
  "provisioning",
  "active",
  "provisioning_failed",
  "cancelled",
  "refunded",
] as const;

const paymentStatuses = [
  "pending",
  "succeeded",
  "failed",
  "cancelled",
  "refunded",
] as const;

const provisioningStatuses = [
  "not_started",
  "pending",
  "processing",
  "succeeded",
  "failed",
] as const;

const refundStatuses = [
  "refund_requested",
  "refund_pending",
  "refunded",
  "refund_failed",
] as const;

const subscriptionStatuses = [
  "pending",
  "active",
  "disabled",
  "expired",
  "revoked",
  "error",
] as const;

const provisioningStates = [
  "pending",
  "processing",
  "applied",
  "failed",
] as const;

const supportStatuses = ["new", "in_progress", "resolved"] as const;
const deliveryStatuses = ["pending", "sent", "failed"] as const;
const discountTypes = ["percent", "fixed"] as const;

function timestamps() {
  return {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  };
}

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    telegramUserId: text("telegram_user_id").notNull(),
    username: text("username"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    photoUrl: text("photo_url"),
    languageCode: text("language_code"),
    lastAuthenticatedAt: integer("last_authenticated_at", {
      mode: "timestamp_ms",
    }).notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("users_telegram_user_id_unique").on(table.telegramUserId),
    check(
      "users_telegram_user_id_digits_check",
      sql`length(${table.telegramUserId}) BETWEEN 1 AND 20
        AND ${table.telegramUserId} NOT GLOB '*[^0-9]*'`,
    ),
    check(
      "users_first_name_length_check",
      sql`length(${table.firstName}) BETWEEN 1 AND 64`,
    ),
    check(
      "users_optional_fields_length_check",
      sql`(${table.lastName} IS NULL OR length(${table.lastName}) BETWEEN 1 AND 64)
        AND (${table.username} IS NULL OR length(${table.username}) BETWEEN 1 AND 32)
        AND (${table.languageCode} IS NULL OR length(${table.languageCode}) BETWEEN 2 AND 16)
        AND (${table.photoUrl} IS NULL OR length(${table.photoUrl}) <= 2048)`,
    ),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    idHash: text("id_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    ...timestamps(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expiry_idx").on(table.expiresAt),
    check(
      "sessions_expiry_after_creation_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check("sessions_id_hash_length_check", sql`length(${table.idHash}) = 64`),
  ],
);

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    durationDays: integer("duration_days").notNull(),
    priceStars: integer("price_stars").notNull(),
    currency: text("currency").notNull().default("XTR"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    isFeatured: integer("is_featured", { mode: "boolean" })
      .notNull()
      .default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    index("plans_active_sort_idx").on(table.isActive, table.sortOrder),
    uniqueIndex("plans_one_active_featured_unique")
      .on(table.isFeatured)
      .where(sql`${table.isActive} = 1 AND ${table.isFeatured} = 1`),
    check("plans_duration_positive_check", sql`${table.durationDays} > 0`),
    check("plans_price_positive_check", sql`${table.priceStars} > 0`),
    check("plans_currency_check", sql`${table.currency} = 'XTR'`),
    check(
      "plans_name_length_check",
      sql`length(${table.name}) BETWEEN 1 AND 120`,
    ),
    check(
      "plans_boolean_flags_check",
      sql`${table.isActive} IN (0, 1) AND ${table.isFeatured} IN (0, 1)`,
    ),
  ],
);

export const promoCodes = sqliteTable(
  "promo_codes",
  {
    id: text("id").primaryKey(),
    codeNormalized: text("code_normalized").notNull(),
    discountType: text("discount_type", { enum: discountTypes }).notNull(),
    discountValue: integer("discount_value").notNull(),
    currency: text("currency"),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }),
    endsAt: integer("ends_at", { mode: "timestamp_ms" }),
    maxUses: integer("max_uses"),
    maxUsesPerUser: integer("max_uses_per_user"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("promo_codes_code_normalized_unique").on(table.codeNormalized),
    index("promo_codes_active_window_idx").on(
      table.isActive,
      table.startsAt,
      table.endsAt,
    ),
    check(
      "promo_codes_code_length_check",
      sql`length(${table.codeNormalized}) BETWEEN 3 AND 32`,
    ),
    check(
      "promo_codes_value_check",
      sql`${table.discountValue} > 0
        AND (${table.discountType} != 'percent' OR ${table.discountValue} <= 100)`,
    ),
    check(
      "promo_codes_currency_check",
      sql`(${table.discountType} = 'percent' AND ${table.currency} IS NULL)
        OR (${table.discountType} = 'fixed' AND ${table.currency} = 'XTR')`,
    ),
    check(
      "promo_codes_window_check",
      sql`${table.startsAt} IS NULL
        OR ${table.endsAt} IS NULL
        OR ${table.startsAt} < ${table.endsAt}`,
    ),
    check(
      "promo_codes_limits_check",
      sql`(${table.maxUses} IS NULL OR ${table.maxUses} > 0)
        AND (${table.maxUsesPerUser} IS NULL OR ${table.maxUsesPerUser} > 0)`,
    ),
    check(
      "promo_codes_type_check",
      sql`${table.discountType} IN ('percent', 'fixed')`,
    ),
    check("promo_codes_active_check", sql`${table.isActive} IN (0, 1)`),
  ],
);

export const promoCodePlans = sqliteTable(
  "promo_code_plans",
  {
    promoCodeId: text("promo_code_id")
      .notNull()
      .references(() => promoCodes.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    ...timestamps(),
  },
  (table) => [
    primaryKey({
      columns: [table.promoCodeId, table.planId],
      name: "promo_code_plans_pk",
    }),
    index("promo_code_plans_plan_id_idx").on(table.planId),
  ],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    promoCodeId: text("promo_code_id").references(() => promoCodes.id),
    planNameSnapshot: text("plan_name_snapshot").notNull(),
    planDescriptionSnapshot: text("plan_description_snapshot"),
    durationDaysSnapshot: integer("duration_days_snapshot").notNull(),
    priceStarsSnapshot: integer("price_stars_snapshot").notNull(),
    promoCodeSnapshot: text("promo_code_snapshot"),
    discountTypeSnapshot: text("discount_type_snapshot", {
      enum: discountTypes,
    }),
    discountValueSnapshot: integer("discount_value_snapshot"),
    subtotalStars: integer("subtotal_stars").notNull(),
    discountStars: integer("discount_stars").notNull().default(0),
    totalStars: integer("total_stars").notNull(),
    currency: text("currency").notNull().default("XTR"),
    status: text("status", { enum: orderStatuses })
      .notNull()
      .default("pending_payment"),
    provisioningStatus: text("provisioning_status", {
      enum: provisioningStatuses,
    })
      .notNull()
      .default("not_started"),
    provisioningAttempts: integer("provisioning_attempts").notNull().default(0),
    provisioningErrorCode: text("provisioning_error_code"),
    provisionedAt: integer("provisioned_at", { mode: "timestamp_ms" }),
    idempotencyKey: text("idempotency_key").notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("orders_idempotency_key_unique").on(table.idempotencyKey),
    index("orders_user_created_idx").on(table.userId, table.createdAt),
    index("orders_provisioning_status_idx").on(
      table.provisioningStatus,
      table.updatedAt,
    ),
    check(
      "orders_duration_positive_check",
      sql`${table.durationDaysSnapshot} > 0`,
    ),
    check(
      "orders_amounts_check",
      sql`${table.subtotalStars} > 0
        AND ${table.priceStarsSnapshot} > 0
        AND ${table.discountStars} >= 0
        AND ${table.discountStars} <= ${table.subtotalStars}
        AND ${table.totalStars} = ${table.subtotalStars} - ${table.discountStars}
        AND ${table.totalStars} >= 0`,
    ),
    check("orders_currency_check", sql`${table.currency} = 'XTR'`),
    check(
      "orders_provisioning_attempts_check",
      sql`${table.provisioningAttempts} >= 0`,
    ),
    check(
      "orders_status_check",
      sql`${table.status} IN (
        'pending_payment',
        'paid',
        'provisioning',
        'active',
        'provisioning_failed',
        'cancelled',
        'refunded'
      )`,
    ),
    check(
      "orders_provisioning_status_check",
      sql`${table.provisioningStatus} IN (
        'not_started',
        'pending',
        'processing',
        'succeeded',
        'failed'
      )`,
    ),
    check(
      "orders_discount_type_check",
      sql`${table.discountTypeSnapshot} IS NULL
        OR ${table.discountTypeSnapshot} IN ('percent', 'fixed')`,
    ),
  ],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    provider: text("provider").notNull().default("telegram_stars"),
    invoicePayload: text("invoice_payload").notNull(),
    telegramPaymentChargeId: text("telegram_payment_charge_id"),
    status: text("status", { enum: paymentStatuses })
      .notNull()
      .default("pending"),
    amountStars: integer("amount_stars").notNull(),
    currency: text("currency").notNull().default("XTR"),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    refundedAt: integer("refunded_at", { mode: "timestamp_ms" }),
    providerPayloadSafe: text("provider_payload_safe"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("payments_invoice_payload_unique").on(table.invoicePayload),
    uniqueIndex("payments_telegram_charge_id_unique").on(
      table.telegramPaymentChargeId,
    ),
    index("payments_order_id_idx").on(table.orderId),
    check("payments_provider_check", sql`${table.provider} = 'telegram_stars'`),
    check(
      "payments_invoice_payload_check",
      sql`length(${table.invoicePayload}) <= 128
        AND ${table.invoicePayload} LIKE 'v1:%'`,
    ),
    check("payments_amount_positive_check", sql`${table.amountStars} > 0`),
    check("payments_currency_check", sql`${table.currency} = 'XTR'`),
    check(
      "payments_status_check",
      sql`${table.status} IN (
        'pending',
        'succeeded',
        'failed',
        'cancelled',
        'refunded'
      )`,
    ),
    check(
      "payments_charge_id_check",
      sql`${table.telegramPaymentChargeId} IS NULL
        OR length(${table.telegramPaymentChargeId}) > 0`,
    ),
  ],
);

export const paymentEvents = sqliteTable(
  "payment_events",
  {
    provider: text("provider").notNull().default("telegram_stars"),
    externalEventId: text("external_event_id").notNull(),
    eventType: text("event_type").notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
    processedAt: integer("processed_at", { mode: "timestamp_ms" }),
    processingErrorCode: text("processing_error_code"),
    ...timestamps(),
  },
  (table) => [
    primaryKey({
      columns: [table.provider, table.externalEventId],
      name: "payment_events_provider_external_id_pk",
    }),
    index("payment_events_processing_idx").on(
      table.processedAt,
      table.receivedAt,
    ),
    check(
      "payment_events_provider_check",
      sql`${table.provider} = 'telegram_stars'`,
    ),
  ],
);

export const refunds = sqliteTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    amountStars: integer("amount_stars").notNull(),
    currency: text("currency").notNull().default("XTR"),
    status: text("status", { enum: refundStatuses })
      .notNull()
      .default("refund_requested"),
    reasonCode: text("reason_code").notNull(),
    providerEvidenceSafe: text("provider_evidence_safe"),
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
    failedAt: integer("failed_at", { mode: "timestamp_ms" }),
    ...timestamps(),
  },
  (table) => [
    index("refunds_payment_id_idx").on(table.paymentId),
    uniqueIndex("refunds_one_confirmed_per_payment_unique")
      .on(table.paymentId)
      .where(sql`${table.status} = 'refunded'`),
    check("refunds_amount_positive_check", sql`${table.amountStars} > 0`),
    check("refunds_currency_check", sql`${table.currency} = 'XTR'`),
    check(
      "refunds_confirmation_check",
      sql`(${table.status} != 'refunded' OR ${table.confirmedAt} IS NOT NULL)
        AND (${table.status} != 'refund_failed' OR ${table.failedAt} IS NOT NULL)`,
    ),
    check(
      "refunds_status_check",
      sql`${table.status} IN (
        'refund_requested',
        'refund_pending',
        'refunded',
        'refund_failed'
      )`,
    ),
  ],
);

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    marzbanUsername: text("marzban_username").notNull(),
    status: text("status", { enum: subscriptionStatuses })
      .notNull()
      .default("pending"),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    subscriptionUrlEncrypted: text("subscription_url_encrypted"),
    lastSyncedAt: integer("last_synced_at", {
      mode: "timestamp_ms",
    }).notNull(),
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("subscriptions_user_id_unique").on(table.userId),
    uniqueIndex("subscriptions_marzban_username_unique").on(
      table.marzbanUsername,
    ),
    index("subscriptions_status_expiry_idx").on(table.status, table.expiresAt),
    check(
      "subscriptions_expiry_after_start_check",
      sql`${table.expiresAt} > ${table.startsAt}`,
    ),
    check("subscriptions_version_check", sql`${table.version} > 0`),
    check(
      "subscriptions_status_check",
      sql`${table.status} IN (
        'pending',
        'active',
        'disabled',
        'expired',
        'revoked',
        'error'
      )`,
    ),
  ],
);

export const orderProvisioning = sqliteTable(
  "order_provisioning",
  {
    orderId: text("order_id")
      .primaryKey()
      .references(() => orders.id),
    appliedDurationDays: integer("applied_duration_days").notNull(),
    targetExpiresAt: integer("target_expires_at", {
      mode: "timestamp_ms",
    }).notNull(),
    state: text("state", { enum: provisioningStates })
      .notNull()
      .default("pending"),
    lockedAt: integer("locked_at", { mode: "timestamp_ms" }),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }),
    lastErrorCode: text("last_error_code"),
    ...timestamps(),
  },
  (table) => [
    index("order_provisioning_retry_idx").on(table.state, table.nextAttemptAt),
    check(
      "order_provisioning_duration_positive_check",
      sql`${table.appliedDurationDays} > 0`,
    ),
    check(
      "order_provisioning_state_check",
      sql`${table.state} IN ('pending', 'processing', 'applied', 'failed')`,
    ),
  ],
);

export const faqItems = sqliteTable(
  "faq_items",
  {
    id: text("id").primaryKey(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: integer("is_published", { mode: "boolean" })
      .notNull()
      .default(false),
    ...timestamps(),
  },
  (table) => [
    index("faq_items_published_sort_idx").on(
      table.isPublished,
      table.sortOrder,
    ),
    check(
      "faq_items_question_length_check",
      sql`length(${table.question}) BETWEEN 3 AND 240`,
    ),
    check(
      "faq_items_answer_length_check",
      sql`length(${table.answer}) BETWEEN 1 AND 10000`,
    ),
    check("faq_items_published_check", sql`${table.isPublished} IN (0, 1)`),
  ],
);

export const supportTickets = sqliteTable(
  "support_tickets",
  {
    id: text("id").primaryKey(),
    publicNumber: text("public_number").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    status: text("status", { enum: supportStatuses }).notNull().default("new"),
    telegramDeliveryStatus: text("telegram_delivery_status", {
      enum: deliveryStatuses,
    })
      .notNull()
      .default("pending"),
    telegramMessageId: text("telegram_message_id"),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("support_tickets_public_number_unique").on(table.publicNumber),
    index("support_tickets_user_created_idx").on(table.userId, table.createdAt),
    index("support_tickets_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    check(
      "support_tickets_subject_length_check",
      sql`length(${table.subject}) BETWEEN 3 AND 120`,
    ),
    check(
      "support_tickets_message_length_check",
      sql`length(${table.message}) BETWEEN 10 AND 4000`,
    ),
    check(
      "support_tickets_resolved_at_check",
      sql`${table.status} != 'resolved' OR ${table.resolvedAt} IS NOT NULL`,
    ),
    check(
      "support_tickets_status_check",
      sql`${table.status} IN ('new', 'in_progress', 'resolved')`,
    ),
    check(
      "support_tickets_delivery_status_check",
      sql`${table.telegramDeliveryStatus} IN ('pending', 'sent', 'failed')`,
    ),
  ],
);

export const adminAuditLog = sqliteTable(
  "admin_audit_log",
  {
    id: text("id").primaryKey(),
    adminUserId: text("admin_user_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("admin_audit_log_admin_created_idx").on(
      table.adminUserId,
      table.createdAt,
    ),
    index("admin_audit_log_entity_idx").on(table.entityType, table.entityId),
    check(
      "admin_audit_log_before_json_check",
      sql`${table.beforeJson} IS NULL OR json_valid(${table.beforeJson})`,
    ),
    check(
      "admin_audit_log_after_json_check",
      sql`${table.afterJson} IS NULL OR json_valid(${table.afterJson})`,
    ),
  ],
);

export type UserRecord = typeof users.$inferSelect;
export type NewUserRecord = typeof users.$inferInsert;

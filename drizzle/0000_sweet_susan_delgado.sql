CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "admin_audit_log_before_json_check" CHECK("admin_audit_log"."before_json" IS NULL OR json_valid("admin_audit_log"."before_json")),
	CONSTRAINT "admin_audit_log_after_json_check" CHECK("admin_audit_log"."after_json" IS NULL OR json_valid("admin_audit_log"."after_json"))
);
--> statement-breakpoint
CREATE INDEX `admin_audit_log_admin_created_idx` ON `admin_audit_log` (`admin_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `admin_audit_log_entity_idx` ON `admin_audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `faq_items` (
	`id` text PRIMARY KEY NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "faq_items_question_length_check" CHECK(length("faq_items"."question") BETWEEN 3 AND 240),
	CONSTRAINT "faq_items_answer_length_check" CHECK(length("faq_items"."answer") BETWEEN 1 AND 10000),
	CONSTRAINT "faq_items_published_check" CHECK("faq_items"."is_published" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `faq_items_published_sort_idx` ON `faq_items` (`is_published`,`sort_order`);--> statement-breakpoint
CREATE TABLE `order_provisioning` (
	`order_id` text PRIMARY KEY NOT NULL,
	`applied_duration_days` integer NOT NULL,
	`target_expires_at` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`locked_at` integer,
	`next_attempt_at` integer,
	`last_error_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_provisioning_duration_positive_check" CHECK("order_provisioning"."applied_duration_days" > 0),
	CONSTRAINT "order_provisioning_state_check" CHECK("order_provisioning"."state" IN ('pending', 'processing', 'applied', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `order_provisioning_retry_idx` ON `order_provisioning` (`state`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`promo_code_id` text,
	`plan_name_snapshot` text NOT NULL,
	`plan_description_snapshot` text,
	`duration_days_snapshot` integer NOT NULL,
	`price_stars_snapshot` integer NOT NULL,
	`promo_code_snapshot` text,
	`discount_type_snapshot` text,
	`discount_value_snapshot` integer,
	`subtotal_stars` integer NOT NULL,
	`discount_stars` integer DEFAULT 0 NOT NULL,
	`total_stars` integer NOT NULL,
	`currency` text DEFAULT 'XTR' NOT NULL,
	`status` text DEFAULT 'pending_payment' NOT NULL,
	`provisioning_status` text DEFAULT 'not_started' NOT NULL,
	`provisioning_attempts` integer DEFAULT 0 NOT NULL,
	`provisioning_error_code` text,
	`provisioned_at` integer,
	`idempotency_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`promo_code_id`) REFERENCES `promo_codes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orders_duration_positive_check" CHECK("orders"."duration_days_snapshot" > 0),
	CONSTRAINT "orders_amounts_check" CHECK("orders"."subtotal_stars" > 0
        AND "orders"."price_stars_snapshot" > 0
        AND "orders"."discount_stars" >= 0
        AND "orders"."discount_stars" <= "orders"."subtotal_stars"
        AND "orders"."total_stars" = "orders"."subtotal_stars" - "orders"."discount_stars"
        AND "orders"."total_stars" >= 0),
	CONSTRAINT "orders_currency_check" CHECK("orders"."currency" = 'XTR'),
	CONSTRAINT "orders_provisioning_attempts_check" CHECK("orders"."provisioning_attempts" >= 0),
	CONSTRAINT "orders_status_check" CHECK("orders"."status" IN (
        'pending_payment',
        'paid',
        'provisioning',
        'active',
        'provisioning_failed',
        'cancelled',
        'refunded'
      )),
	CONSTRAINT "orders_provisioning_status_check" CHECK("orders"."provisioning_status" IN (
        'not_started',
        'pending',
        'processing',
        'succeeded',
        'failed'
      )),
	CONSTRAINT "orders_discount_type_check" CHECK("orders"."discount_type_snapshot" IS NULL
        OR "orders"."discount_type_snapshot" IN ('percent', 'fixed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_key_unique` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `orders_user_created_idx` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_provisioning_status_idx` ON `orders` (`provisioning_status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `payment_events` (
	`provider` text DEFAULT 'telegram_stars' NOT NULL,
	`external_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	`processing_error_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`provider`, `external_event_id`),
	CONSTRAINT "payment_events_provider_check" CHECK("payment_events"."provider" = 'telegram_stars')
);
--> statement-breakpoint
CREATE INDEX `payment_events_processing_idx` ON `payment_events` (`processed_at`,`received_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`provider` text DEFAULT 'telegram_stars' NOT NULL,
	`invoice_payload` text NOT NULL,
	`telegram_payment_charge_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`amount_stars` integer NOT NULL,
	`currency` text DEFAULT 'XTR' NOT NULL,
	`paid_at` integer,
	`refunded_at` integer,
	`provider_payload_safe` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_provider_check" CHECK("payments"."provider" = 'telegram_stars'),
	CONSTRAINT "payments_invoice_payload_check" CHECK(length("payments"."invoice_payload") <= 128
        AND "payments"."invoice_payload" LIKE 'v1:%'),
	CONSTRAINT "payments_amount_positive_check" CHECK("payments"."amount_stars" > 0),
	CONSTRAINT "payments_currency_check" CHECK("payments"."currency" = 'XTR'),
	CONSTRAINT "payments_status_check" CHECK("payments"."status" IN (
        'pending',
        'succeeded',
        'failed',
        'cancelled',
        'refunded'
      )),
	CONSTRAINT "payments_charge_id_check" CHECK("payments"."telegram_payment_charge_id" IS NULL
        OR length("payments"."telegram_payment_charge_id") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_invoice_payload_unique` ON `payments` (`invoice_payload`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_telegram_charge_id_unique` ON `payments` (`telegram_payment_charge_id`);--> statement-breakpoint
CREATE INDEX `payments_order_id_idx` ON `payments` (`order_id`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`duration_days` integer NOT NULL,
	`price_stars` integer NOT NULL,
	`currency` text DEFAULT 'XTR' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_featured` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "plans_duration_positive_check" CHECK("plans"."duration_days" > 0),
	CONSTRAINT "plans_price_positive_check" CHECK("plans"."price_stars" > 0),
	CONSTRAINT "plans_currency_check" CHECK("plans"."currency" = 'XTR'),
	CONSTRAINT "plans_name_length_check" CHECK(length("plans"."name") BETWEEN 1 AND 120),
	CONSTRAINT "plans_boolean_flags_check" CHECK("plans"."is_active" IN (0, 1) AND "plans"."is_featured" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `plans_active_sort_idx` ON `plans` (`is_active`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `plans_one_active_featured_unique` ON `plans` (`is_featured`) WHERE "plans"."is_active" = 1 AND "plans"."is_featured" = 1;--> statement-breakpoint
CREATE TABLE `promo_code_plans` (
	`promo_code_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`promo_code_id`, `plan_id`),
	FOREIGN KEY (`promo_code_id`) REFERENCES `promo_codes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `promo_code_plans_plan_id_idx` ON `promo_code_plans` (`plan_id`);--> statement-breakpoint
CREATE TABLE `promo_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_normalized` text NOT NULL,
	`discount_type` text NOT NULL,
	`discount_value` integer NOT NULL,
	`currency` text,
	`starts_at` integer,
	`ends_at` integer,
	`max_uses` integer,
	`max_uses_per_user` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "promo_codes_code_length_check" CHECK(length("promo_codes"."code_normalized") BETWEEN 3 AND 32),
	CONSTRAINT "promo_codes_value_check" CHECK("promo_codes"."discount_value" > 0
        AND ("promo_codes"."discount_type" != 'percent' OR "promo_codes"."discount_value" <= 100)),
	CONSTRAINT "promo_codes_currency_check" CHECK(("promo_codes"."discount_type" = 'percent' AND "promo_codes"."currency" IS NULL)
        OR ("promo_codes"."discount_type" = 'fixed' AND "promo_codes"."currency" = 'XTR')),
	CONSTRAINT "promo_codes_window_check" CHECK("promo_codes"."starts_at" IS NULL
        OR "promo_codes"."ends_at" IS NULL
        OR "promo_codes"."starts_at" < "promo_codes"."ends_at"),
	CONSTRAINT "promo_codes_limits_check" CHECK(("promo_codes"."max_uses" IS NULL OR "promo_codes"."max_uses" > 0)
        AND ("promo_codes"."max_uses_per_user" IS NULL OR "promo_codes"."max_uses_per_user" > 0)),
	CONSTRAINT "promo_codes_type_check" CHECK("promo_codes"."discount_type" IN ('percent', 'fixed')),
	CONSTRAINT "promo_codes_active_check" CHECK("promo_codes"."is_active" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `promo_codes_code_normalized_unique` ON `promo_codes` (`code_normalized`);--> statement-breakpoint
CREATE INDEX `promo_codes_active_window_idx` ON `promo_codes` (`is_active`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`amount_stars` integer NOT NULL,
	`currency` text DEFAULT 'XTR' NOT NULL,
	`status` text DEFAULT 'refund_requested' NOT NULL,
	`reason_code` text NOT NULL,
	`provider_evidence_safe` text,
	`requested_at` integer NOT NULL,
	`confirmed_at` integer,
	`failed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "refunds_amount_positive_check" CHECK("refunds"."amount_stars" > 0),
	CONSTRAINT "refunds_currency_check" CHECK("refunds"."currency" = 'XTR'),
	CONSTRAINT "refunds_confirmation_check" CHECK(("refunds"."status" != 'refunded' OR "refunds"."confirmed_at" IS NOT NULL)
        AND ("refunds"."status" != 'refund_failed' OR "refunds"."failed_at" IS NOT NULL)),
	CONSTRAINT "refunds_status_check" CHECK("refunds"."status" IN (
        'refund_requested',
        'refund_pending',
        'refunded',
        'refund_failed'
      ))
);
--> statement-breakpoint
CREATE INDEX `refunds_payment_id_idx` ON `refunds` (`payment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_one_confirmed_per_payment_unique` ON `refunds` (`payment_id`) WHERE "refunds"."status" = 'refunded';--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sessions_expiry_after_creation_check" CHECK("sessions"."expires_at" > "sessions"."created_at"),
	CONSTRAINT "sessions_id_hash_length_check" CHECK(length("sessions"."id_hash") = 64)
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`marzban_username` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`starts_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`subscription_url_encrypted` text,
	`last_synced_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "subscriptions_expiry_after_start_check" CHECK("subscriptions"."expires_at" > "subscriptions"."starts_at"),
	CONSTRAINT "subscriptions_version_check" CHECK("subscriptions"."version" > 0),
	CONSTRAINT "subscriptions_status_check" CHECK("subscriptions"."status" IN (
        'pending',
        'active',
        'disabled',
        'expired',
        'revoked',
        'error'
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_user_id_unique` ON `subscriptions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_marzban_username_unique` ON `subscriptions` (`marzban_username`);--> statement-breakpoint
CREATE INDEX `subscriptions_status_expiry_idx` ON `subscriptions` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`public_number` text NOT NULL,
	`user_id` text NOT NULL,
	`subject` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`telegram_delivery_status` text DEFAULT 'pending' NOT NULL,
	`telegram_message_id` text,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "support_tickets_subject_length_check" CHECK(length("support_tickets"."subject") BETWEEN 3 AND 120),
	CONSTRAINT "support_tickets_message_length_check" CHECK(length("support_tickets"."message") BETWEEN 10 AND 4000),
	CONSTRAINT "support_tickets_resolved_at_check" CHECK("support_tickets"."status" != 'resolved' OR "support_tickets"."resolved_at" IS NOT NULL),
	CONSTRAINT "support_tickets_status_check" CHECK("support_tickets"."status" IN ('new', 'in_progress', 'resolved')),
	CONSTRAINT "support_tickets_delivery_status_check" CHECK("support_tickets"."telegram_delivery_status" IN ('pending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_tickets_public_number_unique` ON `support_tickets` (`public_number`);--> statement-breakpoint
CREATE INDEX `support_tickets_user_created_idx` ON `support_tickets` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `support_tickets_status_created_idx` ON `support_tickets` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`telegram_user_id` text NOT NULL,
	`username` text,
	`first_name` text NOT NULL,
	`last_name` text,
	`photo_url` text,
	`language_code` text,
	`last_authenticated_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "users_telegram_user_id_digits_check" CHECK(length("users"."telegram_user_id") BETWEEN 1 AND 20
        AND "users"."telegram_user_id" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "users_first_name_length_check" CHECK(length("users"."first_name") BETWEEN 1 AND 64),
	CONSTRAINT "users_optional_fields_length_check" CHECK(("users"."last_name" IS NULL OR length("users"."last_name") BETWEEN 1 AND 64)
        AND ("users"."username" IS NULL OR length("users"."username") BETWEEN 1 AND 32)
        AND ("users"."language_code" IS NULL OR length("users"."language_code") BETWEEN 2 AND 16)
        AND ("users"."photo_url" IS NULL OR length("users"."photo_url") <= 2048))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_telegram_user_id_unique` ON `users` (`telegram_user_id`);
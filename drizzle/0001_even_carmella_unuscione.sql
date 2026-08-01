PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` text,
	`promo_code_id` text,
	`source` text DEFAULT 'purchase' NOT NULL,
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
	CONSTRAINT "orders_duration_positive_check" CHECK("__new_orders"."duration_days_snapshot" > 0),
	CONSTRAINT "orders_source_check" CHECK("__new_orders"."source" IN ('purchase', 'admin_grant')),
	CONSTRAINT "orders_amounts_check" CHECK((
          "__new_orders"."source" = 'admin_grant'
          AND "__new_orders"."plan_id" IS NULL
          AND "__new_orders"."subtotal_stars" = 0
          AND "__new_orders"."price_stars_snapshot" = 0
          AND "__new_orders"."discount_stars" = 0
          AND "__new_orders"."total_stars" = 0
        ) OR (
          "__new_orders"."source" = 'purchase'
          AND "__new_orders"."plan_id" IS NOT NULL
          AND "__new_orders"."subtotal_stars" > 0
          AND "__new_orders"."price_stars_snapshot" > 0
          AND "__new_orders"."discount_stars" >= 0
          AND "__new_orders"."discount_stars" <= "__new_orders"."subtotal_stars"
          AND "__new_orders"."total_stars" = "__new_orders"."subtotal_stars" - "__new_orders"."discount_stars"
          AND "__new_orders"."total_stars" >= 0
        )),
	CONSTRAINT "orders_currency_check" CHECK("__new_orders"."currency" = 'XTR'),
	CONSTRAINT "orders_provisioning_attempts_check" CHECK("__new_orders"."provisioning_attempts" >= 0),
	CONSTRAINT "orders_status_check" CHECK("__new_orders"."status" IN (
        'pending_payment',
        'paid',
        'provisioning',
        'active',
        'provisioning_failed',
        'cancelled',
        'refunded'
      )),
	CONSTRAINT "orders_provisioning_status_check" CHECK("__new_orders"."provisioning_status" IN (
        'not_started',
        'pending',
        'processing',
        'succeeded',
        'failed'
      )),
	CONSTRAINT "orders_discount_type_check" CHECK("__new_orders"."discount_type_snapshot" IS NULL
        OR "__new_orders"."discount_type_snapshot" IN ('percent', 'fixed'))
);
--> statement-breakpoint
INSERT INTO `__new_orders`("id", "user_id", "plan_id", "promo_code_id", "source", "plan_name_snapshot", "plan_description_snapshot", "duration_days_snapshot", "price_stars_snapshot", "promo_code_snapshot", "discount_type_snapshot", "discount_value_snapshot", "subtotal_stars", "discount_stars", "total_stars", "currency", "status", "provisioning_status", "provisioning_attempts", "provisioning_error_code", "provisioned_at", "idempotency_key", "created_at", "updated_at") SELECT "id", "user_id", "plan_id", "promo_code_id", 'purchase', "plan_name_snapshot", "plan_description_snapshot", "duration_days_snapshot", "price_stars_snapshot", "promo_code_snapshot", "discount_type_snapshot", "discount_value_snapshot", "subtotal_stars", "discount_stars", "total_stars", "currency", "status", "provisioning_status", "provisioning_attempts", "provisioning_error_code", "provisioned_at", "idempotency_key", "created_at", "updated_at" FROM `orders`;--> statement-breakpoint
DROP TABLE `orders`;--> statement-breakpoint
ALTER TABLE `__new_orders` RENAME TO `orders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_key_unique` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `orders_user_created_idx` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_provisioning_status_idx` ON `orders` (`provisioning_status`,`updated_at`);
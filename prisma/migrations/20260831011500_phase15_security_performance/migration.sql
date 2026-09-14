-- Phase 15: distributed abuse controls + critical-path supporting indexes.

CREATE TABLE `rate_limits` (
  `id` VARCHAR(64) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `count` INT UNSIGNED NOT NULL,
  `last_request` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_rate_limits_key` (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `request_rate_limits` (
  `id` VARCHAR(36) NOT NULL,
  `bucket_key` VARCHAR(191) NOT NULL,
  `count` INT UNSIGNED NOT NULL DEFAULT 0,
  `window_started_at` DATETIME(3) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_request_rate_limits_bucket` (`bucket_key`),
  INDEX `idx_request_rate_limits_expiry` (`expires_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `idx_variants_default_price_product`
  ON `product_variants` (`is_default`, `status`, `price_minor`, `product_id`);

CREATE INDEX `idx_inventory_available_variant`
  ON `inventory_items` (`quantity_available`, `product_variant_id`);

CREATE INDEX `idx_service_requests_user_created`
  ON `service_requests` (`user_id`, `created_at`, `id`);

CREATE INDEX `idx_service_requests_assignee_queue`
  ON `service_requests` (`assigned_to`, `status`, `created_at`);

CREATE INDEX `idx_webhook_events_status_received`
  ON `webhook_events` (`processing_status`, `received_at`);

-- CreateTable
CREATE TABLE `payment_attempts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `paystack_reference` VARCHAR(100) NOT NULL,
    `amount_minor` INTEGER UNSIGNED NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'NGN',
    `status` ENUM('INITIATED', 'PENDING', 'SUCCESS', 'FAILED', 'ABANDONED', 'INITIALIZATION_FAILED') NOT NULL,
    `channel` VARCHAR(30) NULL,
    `authorization_url` VARCHAR(500) NULL,
    `access_code` VARCHAR(100) NULL,
    `gateway_response` VARCHAR(255) NULL,
    `error_code` VARCHAR(50) NULL,
    `error_message` VARCHAR(500) NULL,
    `refunded_amount_minor` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `pending_refund_amount_minor` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    -- Hand-edited (docs/DATABASE_DESIGN.md §9): generated column, the number
    -- an admin's "refund up to ₦X" UI reads. Same derived-column pattern as
    -- inventory_items.quantity_available.
    `available_refundable_amount_minor` INTEGER UNSIGNED GENERATED ALWAYS AS (`amount_minor` - `refunded_amount_minor` - `pending_refund_amount_minor`) STORED,
    `paid_at` DATETIME(3) NULL,
    `failed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_attempts_paystack_reference_key`(`paystack_reference`),
    INDEX `idx_payment_attempts_order_status`(`order_id`, `status`),
    INDEX `idx_payment_attempts_status_created`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Hand-edited (docs/DATABASE_DESIGN.md §9): secondary defense-in-depth —
-- the primary mechanism is the application's conditional UPDATE (Allocate
-- transaction), which checks BOTH refunded and pending amounts together.
ALTER TABLE `payment_attempts`
  ADD CONSTRAINT `chk_payment_attempts_refund_allocation` CHECK (
    `refunded_amount_minor` + `pending_refund_amount_minor` <= `amount_minor`
  );

-- CreateTable
CREATE TABLE `webhook_events` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(20) NOT NULL DEFAULT 'paystack',
    `event_type` VARCHAR(50) NOT NULL,
    `paystack_transaction_id` VARCHAR(50) NOT NULL,
    `paystack_reference` VARCHAR(100) NULL,
    `raw_payload` JSON NOT NULL,
    `processing_status` ENUM('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `processing_attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `locked_at` DATETIME(3) NULL,
    `processed_at` DATETIME(3) NULL,
    `error_message` TEXT NULL,
    `resolved_payment_attempt_id` BIGINT UNSIGNED NULL,
    `resolved_refund_id` BIGINT UNSIGNED NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_webhook_events_claim`(`processing_status`, `locked_at`),
    INDEX `idx_webhook_events_reference`(`paystack_reference`),
    UNIQUE INDEX `uq_webhook_events_natural_key`(`event_type`, `paystack_transaction_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Hand-edited (docs/DATABASE_DESIGN.md §8): a webhook event resolves to at
-- most one of a payment attempt or a refund, never both.
ALTER TABLE `webhook_events`
  ADD CONSTRAINT `chk_webhook_events_resolved_exclusive` CHECK (
    `resolved_payment_attempt_id` IS NULL OR `resolved_refund_id` IS NULL
  );

-- CreateTable
CREATE TABLE `refunds` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `payment_attempt_id` BIGINT UNSIGNED NOT NULL,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `paystack_refund_reference` VARCHAR(100) NULL,
    `amount_minor` INTEGER UNSIGNED NOT NULL,
    `status` ENUM('REFUND_REQUESTED', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED', 'REFUND_CANCELLED') NOT NULL,
    `reason` TEXT NULL,
    `requested_by` BIGINT UNSIGNED NOT NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,
    `raw_webhook_payload` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `refunds_paystack_refund_reference_key`(`paystack_refund_reference`),
    INDEX `idx_refunds_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_authoritative_payment_attempt_id_fkey` FOREIGN KEY (`authoritative_payment_attempt_id`) REFERENCES `payment_attempts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_attempts` ADD CONSTRAINT `payment_attempts_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Hand-edited: ON DELETE changed from SET NULL (as documented in
-- docs/DATABASE_DESIGN.md §8) to RESTRICT. MySQL error 3823 refuses a CHECK
-- constraint on any column participating in a SET NULL/CASCADE FK
-- referential action, and the mutual-exclusivity CHECK below is a "MUST be
-- preserved" requirement. No behavioral change in practice: payment_attempts
-- rows are never deleted in this design. Documented deviation, not a silent
-- redesign — see the Phase 2B implementation report. ON UPDATE also changed
-- to RESTRICT (CASCADE hits the identical MySQL 3823 restriction).
ALTER TABLE `webhook_events` ADD CONSTRAINT `webhook_events_resolved_payment_attempt_id_fkey` FOREIGN KEY (`resolved_payment_attempt_id`) REFERENCES `payment_attempts`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
-- Hand-edited: same MySQL 3823 conflict as above. Both actions RESTRICT;
-- refunds rows are never deleted/updated-by-cascade in this design.
ALTER TABLE `webhook_events` ADD CONSTRAINT `webhook_events_resolved_refund_id_fkey` FOREIGN KEY (`resolved_refund_id`) REFERENCES `refunds`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_payment_attempt_id_fkey` FOREIGN KEY (`payment_attempt_id`) REFERENCES `payment_attempts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_requested_by_fkey` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

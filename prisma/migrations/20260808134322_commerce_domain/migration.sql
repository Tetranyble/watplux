-- CreateTable
CREATE TABLE `addresses` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `label` VARCHAR(50) NULL,
    `full_name` VARCHAR(255) NOT NULL,
    `phone` VARCHAR(32) NOT NULL,
    `address_line1` VARCHAR(255) NOT NULL,
    `address_line2` VARCHAR(255) NULL,
    `city` VARCHAR(100) NOT NULL,
    `state` VARCHAR(100) NOT NULL,
    `country` VARCHAR(100) NOT NULL,
    `postal_code` VARCHAR(20) NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    -- Hand-edited (docs/DATABASE_DESIGN.md §10): generated column, "at most
    -- one default address per user" — same technique as product_variants.
    `default_address_key` BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN `is_default` THEN `user_id` ELSE NULL END) STORED,

    UNIQUE INDEX `uq_one_default_address_per_user`(`default_address_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NULL,
    `guest_token_hash` CHAR(64) NULL,
    `status` ENUM('ACTIVE', 'CONVERTED', 'ABANDONED') NOT NULL DEFAULT 'ACTIVE',
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    -- Hand-edited (docs/DATABASE_DESIGN.md §6): generated columns, NULL
    -- unless status='ACTIVE'. Back "one ACTIVE cart per user"/"per guest
    -- token" while leaving CONVERTED/ABANDONED history completely
    -- unrestricted in number — the corrected design (was plain
    -- UNIQUE(user_id)/UNIQUE(guest_token_hash), which forbade more than one
    -- cart row per identity ever).
    `active_cart_user_key` BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN `status` = 'ACTIVE' THEN `user_id` ELSE NULL END) STORED,
    `active_cart_guest_key` CHAR(64) GENERATED ALWAYS AS (CASE WHEN `status` = 'ACTIVE' THEN `guest_token_hash` ELSE NULL END) STORED,

    UNIQUE INDEX `uq_one_active_cart_per_user`(`active_cart_user_key`),
    UNIQUE INDEX `uq_one_active_cart_per_guest_token`(`active_cart_guest_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Hand-edited (docs/DATABASE_DESIGN.md §6): a cart has exactly one identity
-- axis, always — a user and a guest can never accidentally share a cart.
ALTER TABLE `carts`
  ADD CONSTRAINT `chk_carts_identity_exclusive` CHECK (
    (`user_id` IS NOT NULL AND `guest_token_hash` IS NULL) OR
    (`user_id` IS NULL AND `guest_token_hash` IS NOT NULL)
  );

-- CreateTable
CREATE TABLE `cart_items` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `cart_id` BIGINT UNSIGNED NOT NULL,
    `product_variant_id` BIGINT UNSIGNED NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL,
    `price_snapshot_minor` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_cart_items_cart_variant`(`cart_id`, `product_variant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_number` VARCHAR(30) NOT NULL,
    `user_id` BIGINT UNSIGNED NULL,
    `guest_email` VARCHAR(255) NULL,
    `guest_phone` VARCHAR(32) NULL,
    `status` ENUM('PENDING_PAYMENT', 'PAID', 'PROCESSING', 'READY_FOR_DISPATCH', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED') NOT NULL,
    `authoritative_payment_attempt_id` BIGINT UNSIGNED NULL,
    `subtotal_minor` INTEGER UNSIGNED NOT NULL,
    `discount_minor` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `delivery_fee_minor` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `tax_minor` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `total_minor` INTEGER UNSIGNED NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'NGN',
    `customer_note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `orders_order_number_key`(`order_number`),
    UNIQUE INDEX `uq_orders_authoritative_payment_attempt`(`authoritative_payment_attempt_id`),
    INDEX `idx_orders_user_created`(`user_id`, `created_at`),
    INDEX `idx_orders_status_created`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Hand-edited (docs/DATABASE_DESIGN.md §7): cheap, always-true arithmetic
-- invariant — defense against a bug in the order-total calculation ever
-- persisting an inconsistent total.
ALTER TABLE `orders`
  ADD CONSTRAINT `chk_orders_total_arithmetic` CHECK (
    `total_minor` = `subtotal_minor` - `discount_minor` + `delivery_fee_minor` + `tax_minor`
  );

-- CreateTable
CREATE TABLE `order_items` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `product_id` BIGINT UNSIGNED NULL,
    `product_variant_id` BIGINT UNSIGNED NULL,
    `product_name_snapshot` VARCHAR(255) NOT NULL,
    `sku_snapshot` VARCHAR(64) NOT NULL,
    `variant_label_snapshot` VARCHAR(255) NULL,
    `unit_price_minor` INTEGER UNSIGNED NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL,
    `discount_minor` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `tax_minor` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `line_total_minor` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_one_line_per_variant_per_order`(`order_id`, `product_variant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_addresses` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `type` ENUM('SHIPPING', 'BILLING') NOT NULL,
    `full_name` VARCHAR(255) NOT NULL,
    `phone` VARCHAR(32) NOT NULL,
    `address_line1` VARCHAR(255) NOT NULL,
    `address_line2` VARCHAR(255) NULL,
    `city` VARCHAR(100) NOT NULL,
    `state` VARCHAR(100) NOT NULL,
    `country` CHAR(2) NOT NULL DEFAULT 'NG',
    `postal_code` VARCHAR(20) NULL,
    `delivery_notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_order_addresses_order_type`(`order_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_status_history` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `from_status` VARCHAR(30) NOT NULL,
    `to_status` VARCHAR(30) NOT NULL,
    `actor_type` ENUM('SYSTEM', 'ADMIN', 'WEBHOOK') NOT NULL,
    `actor_id` BIGINT UNSIGNED NULL,
    `note` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_order_status_history_order`(`order_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupons` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `type` ENUM('FLAT', 'PERCENTAGE') NOT NULL,
    `value_minor` INTEGER UNSIGNED NULL,
    `percentage` DECIMAL(5, 2) NULL,
    `max_discount_minor` INTEGER UNSIGNED NULL,
    `min_order_amount_minor` INTEGER UNSIGNED NULL,
    `usage_limit` INTEGER UNSIGNED NULL,
    `usage_limit_per_customer` SMALLINT UNSIGNED NULL,
    `starts_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `coupons_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Hand-edited (docs/DATABASE_DESIGN.md §13): mutual-exclusivity check —
-- exactly one of value_minor/percentage is populated, matching the coupon's
-- own type.
ALTER TABLE `coupons`
  ADD CONSTRAINT `chk_coupons_type_value_exclusive` CHECK (
    (`type` = 'FLAT' AND `value_minor` IS NOT NULL AND `percentage` IS NULL) OR
    (`type` = 'PERCENTAGE' AND `percentage` IS NOT NULL AND `value_minor` IS NULL)
  );

-- CreateTable
CREATE TABLE `coupon_redemptions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `coupon_id` BIGINT UNSIGNED NOT NULL,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NULL,
    `discount_applied_minor` INTEGER UNSIGNED NOT NULL,
    `redeemed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `coupon_redemptions_order_id_key`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
-- Hand-edited: ON DELETE changed from CASCADE (as documented in
-- docs/DATABASE_DESIGN.md §10) to RESTRICT. MySQL error 1215 rejects any FK
-- with ON DELETE CASCADE/SET NULL/SET DEFAULT on a column that a STORED
-- generated column in the same table reads — user_id feeds
-- default_address_key. Documented deviation, not a silent redesign; see the
-- Phase 2B implementation report for the full explanation and consequence.
ALTER TABLE `addresses` ADD CONSTRAINT `addresses_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
-- Hand-edited: same MySQL 1215 conflict as addresses above (user_id feeds
-- active_cart_user_key). ON DELETE changed from CASCADE to RESTRICT.
ALTER TABLE `carts` ADD CONSTRAINT `carts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_cart_id_fkey` FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_product_variant_id_fkey` FOREIGN KEY (`product_variant_id`) REFERENCES `product_variants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_variant_id_fkey` FOREIGN KEY (`product_variant_id`) REFERENCES `product_variants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_addresses` ADD CONSTRAINT `order_addresses_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_status_history` ADD CONSTRAINT `order_status_history_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_status_history` ADD CONSTRAINT `order_status_history_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_redemptions` ADD CONSTRAINT `coupon_redemptions_coupon_id_fkey` FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_redemptions` ADD CONSTRAINT `coupon_redemptions_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_redemptions` ADD CONSTRAINT `coupon_redemptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `inventory_items` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_variant_id` BIGINT UNSIGNED NOT NULL,
    `quantity_on_hand` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    `quantity_reserved` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    -- Hand-edited (docs/DATABASE_DESIGN.md §5): generated column, always
    -- derived, never independently writable. STORED so it can be indexed
    -- and read cheaply on the storefront's "in stock" check.
    `quantity_available` DECIMAL(12, 3) GENERATED ALWAYS AS (`quantity_on_hand` - `quantity_reserved`) STORED,
    `low_stock_threshold` DECIMAL(12, 3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `inventory_items_product_variant_id_key`(`product_variant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Hand-edited (docs/DATABASE_DESIGN.md §5): defense-in-depth CHECKs, not the
-- primary concurrency mechanism (that's the conditional UPDATE...WHERE
-- pattern implemented at the application layer, Phase 5+).
ALTER TABLE `inventory_items`
  ADD CONSTRAINT `chk_inventory_items_on_hand_nonneg` CHECK (`quantity_on_hand` >= 0),
  ADD CONSTRAINT `chk_inventory_items_reserved_nonneg` CHECK (`quantity_reserved` >= 0),
  ADD CONSTRAINT `chk_inventory_items_reserved_le_on_hand` CHECK (`quantity_reserved` <= `quantity_on_hand`);

-- CreateTable
CREATE TABLE `inventory_movements` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `inventory_item_id` BIGINT UNSIGNED NOT NULL,
    `type` ENUM('RESTOCK', 'RESERVE', 'RELEASE', 'SALE', 'RETURN', 'ADJUSTMENT') NOT NULL,
    `on_hand_delta` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    `reserved_delta` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    `order_item_id` BIGINT UNSIGNED NULL,
    `reference_type` ENUM('MANUAL', 'PURCHASE_ORDER') NULL,
    `reference_id` BIGINT UNSIGNED NULL,
    `note` TEXT NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    -- Hand-edited (docs/DATABASE_DESIGN.md §5, invariant 8): generated
    -- column, CONCAT(type, '-', order_item_id) for RESERVE/RELEASE/SALE
    -- only, else NULL. The UNIQUE index on it guarantees "at most one
    -- RESERVE/RELEASE/SALE per order item" — precisely, not approximately.
    -- RETURN is deliberately excluded: multiple RETURN rows per order item
    -- are legitimate (partial returns over time).
    `order_item_movement_dedup_key` VARCHAR(80) GENERATED ALWAYS AS (CASE WHEN `type` IN ('RESERVE', 'RELEASE', 'SALE') THEN CONCAT(`type`, '-', `order_item_id`) ELSE NULL END) STORED,

    UNIQUE INDEX `uq_one_reserve_release_sale_per_order_item`(`order_item_movement_dedup_key`),
    INDEX `idx_inventory_movements_item_history`(`inventory_item_id`, `created_at`),
    INDEX `idx_inventory_movements_order_item`(`order_item_id`),
    INDEX `idx_inventory_movements_reference`(`reference_type`, `reference_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Hand-edited: Phase 2B hardening requirement — RESERVE/RELEASE/SALE
-- movements must always carry an order_item_id (the generated dedup key
-- alone is insufficient, since MySQL UNIQUE indexes permit unlimited NULLs).
ALTER TABLE `inventory_movements`
  ADD CONSTRAINT `chk_inventory_movements_order_item_required` CHECK (
    `type` NOT IN ('RESERVE', 'RELEASE', 'SALE') OR `order_item_id` IS NOT NULL
  );

-- AddForeignKey
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_product_variant_id_fkey` FOREIGN KEY (`product_variant_id`) REFERENCES `product_variants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_inventory_item_id_fkey` FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `brands` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(150) NOT NULL,
    `slug` VARCHAR(150) NOT NULL,
    `logo_url` VARCHAR(500) NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `brands_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `parent_id` BIGINT UNSIGNED NULL,
    `name` VARCHAR(150) NOT NULL,
    `slug` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `image_url` VARCHAR(500) NULL,
    `sort_order` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `seo_title` VARCHAR(255) NULL,
    `seo_description` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `categories_slug_key`(`slug`),
    INDEX `idx_categories_tree`(`parent_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `brand_id` BIGINT UNSIGNED NULL,
    `category_id` BIGINT UNSIGNED NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `slug` VARCHAR(255) NOT NULL,
    `short_description` VARCHAR(500) NULL,
    `description` TEXT NULL,
    `unit_of_measure` ENUM('EACH', 'METER') NOT NULL DEFAULT 'EACH',
    `status` ENUM('DRAFT', 'ACTIVE', 'ARCHIVED') NOT NULL,
    `is_featured` BOOLEAN NOT NULL DEFAULT false,
    `warranty_months` SMALLINT UNSIGNED NULL,
    `seo_title` VARCHAR(255) NULL,
    `seo_description` VARCHAR(500) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `products_slug_key`(`slug`),
    INDEX `idx_products_category_status`(`category_id`, `status`),
    INDEX `idx_products_featured`(`status`, `is_featured`, `created_at`),
    INDEX `idx_products_brand`(`brand_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_variants` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `sku` VARCHAR(64) NOT NULL,
    `variant_label` VARCHAR(255) NULL,
    `option_values` JSON NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL,
    `sort_order` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `price_minor` INTEGER UNSIGNED NOT NULL,
    `compare_at_price_minor` INTEGER UNSIGNED NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'NGN',
    `power_rating_w` SMALLINT UNSIGNED NULL,
    `voltage_v` SMALLINT UNSIGNED NULL,
    `capacity_wh` INTEGER UNSIGNED NULL,
    `rated_current_a` SMALLINT UNSIGNED NULL,
    `phase` ENUM('SINGLE', 'THREE') NULL,
    `efficiency_percent` DECIMAL(5, 2) NULL,
    `mppt_min_v` SMALLINT UNSIGNED NULL,
    `mppt_max_v` SMALLINT UNSIGNED NULL,
    `weight_kg` DECIMAL(8, 3) NULL,
    `length_cm` DECIMAL(8, 2) NULL,
    `width_cm` DECIMAL(8, 2) NULL,
    `height_cm` DECIMAL(8, 2) NULL,
    -- Hand-edited (docs/DATABASE_DESIGN.md §2): generated column, not a
    -- plain writable one. NULL unless is_default=true, in which case it
    -- equals product_id. The UNIQUE index below on this column is what
    -- enforces "at most one default variant per product" — never "exactly
    -- one" or "at least one," which are application-transaction guarantees
    -- (see docs/DATABASE_DESIGN.md §2 for the precise split).
    `default_variant_key` BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN `is_default` THEN `product_id` ELSE NULL END) STORED,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `product_variants_sku_key`(`sku`),
    UNIQUE INDEX `uq_at_most_one_default_variant_per_product`(`default_variant_key`),
    INDEX `idx_product_variants_product_status`(`product_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_images` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `alt_text` VARCHAR(255) NULL,
    `width` SMALLINT UNSIGNED NULL,
    `height` SMALLINT UNSIGNED NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_product_images_order`(`product_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_specifications` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `spec_key` VARCHAR(100) NOT NULL,
    `spec_value` VARCHAR(500) NOT NULL,
    `unit` VARCHAR(20) NULL,
    `group_label` VARCHAR(100) NULL,
    `sort_order` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_product_specifications_key`(`product_id`, `spec_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Hand-edited: ON UPDATE changed from CASCADE to RESTRICT. MySQL rejects
-- ON UPDATE CASCADE/SET NULL on any column a STORED generated column reads
-- (error 1215) — product_id is read by default_variant_key's generated
-- expression above. Primary keys are never updated in practice, so this
-- changes nothing behaviorally; it only satisfies MySQL's requirement.
ALTER TABLE `product_variants` ADD CONSTRAINT `product_variants_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_specifications` ADD CONSTRAINT `product_specifications_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

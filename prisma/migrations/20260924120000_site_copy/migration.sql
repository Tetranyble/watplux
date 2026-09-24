CREATE TABLE `site_copy` (
    `key` VARCHAR(191) NOT NULL,
    `namespace` VARCHAR(100) NOT NULL,
    `label` VARCHAR(150) NOT NULL,
    `value` TEXT NOT NULL,
    `description` VARCHAR(500) NULL,
    `multiline` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_site_copy_namespace_order`(`namespace`, `sort_order`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `site_copy` ADD CONSTRAINT `site_copy_updated_by_fkey`
FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

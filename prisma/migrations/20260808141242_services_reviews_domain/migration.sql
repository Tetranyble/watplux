-- CreateTable
CREATE TABLE `service_requests` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NULL,
    `guest_name` VARCHAR(255) NULL,
    `guest_email` VARCHAR(255) NULL,
    `guest_phone` VARCHAR(32) NULL,
    `service_type` ENUM('CONSULTATION', 'SYSTEM_SIZING', 'INSTALLATION', 'MAINTENANCE', 'SITE_ASSESSMENT') NOT NULL,
    `status` ENUM('NEW', 'CONTACTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL,
    `property_type` ENUM('RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL') NULL,
    `location` VARCHAR(500) NULL,
    `current_electricity_situation` TEXT NULL,
    `estimated_monthly_usage_kwh` DECIMAL(10, 2) NULL,
    `appliances` TEXT NULL,
    `desired_backup_hours` DECIMAL(5, 2) NULL,
    `existing_equipment` TEXT NULL,
    `budget_range` VARCHAR(50) NULL,
    `preferred_appointment_at` DATETIME(3) NULL,
    `additional_info` TEXT NULL,
    `assigned_to` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_service_requests_queue`(`status`, `created_at`),
    INDEX `idx_service_requests_type`(`service_type`),
    INDEX `idx_service_requests_assignee`(`assigned_to`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reviews` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `order_item_id` BIGINT UNSIGNED NULL,
    `rating` TINYINT UNSIGNED NOT NULL,
    `title` VARCHAR(255) NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_reviews_product_status`(`product_id`, `status`),
    UNIQUE INDEX `uq_reviews_product_user`(`product_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Hand-edited (docs/DATABASE_DESIGN.md §12): plain per-row range check.
ALTER TABLE `reviews`
  ADD CONSTRAINT `chk_reviews_rating_range` CHECK (`rating` BETWEEN 1 AND 5);

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_assigned_to_fkey` FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

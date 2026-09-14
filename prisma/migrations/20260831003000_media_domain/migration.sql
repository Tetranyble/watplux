-- Phase 14 — reusable media library. Existing catalog URL columns remain intact.
CREATE TABLE `media_assets` (
  `id` VARCHAR(36) NOT NULL,
  `provider` ENUM('LOCAL', 'S3') NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(120) NOT NULL,
  `size_bytes` BIGINT UNSIGNED NOT NULL,
  `storage_key` VARCHAR(700) NOT NULL,
  `public_url` VARCHAR(1000) NOT NULL,
  `width` SMALLINT UNSIGNED NOT NULL,
  `height` SMALLINT UNSIGNED NOT NULL,
  `checksum_sha256` CHAR(64) NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_media_assets_provider_created` (`provider`, `created_at`),
  INDEX `idx_media_assets_creator_created` (`created_by`, `created_at`),
  INDEX `idx_media_assets_checksum` (`checksum_sha256`),
  CONSTRAINT `media_assets_created_by_fkey`
    FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

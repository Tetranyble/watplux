-- Better Auth migration.
-- Preserves numeric users.id because commerce tables already reference it.
-- Existing custom sessions cannot be migrated safely because only SHA-256
-- hashes were stored, so every existing login is intentionally revoked.

-- 1) Bring users into Better Auth's core shape while preserving app fields.
ALTER TABLE `users`
  ADD COLUMN `email_verified` BOOLEAN NOT NULL DEFAULT false AFTER `email`,
  ADD COLUMN `image` VARCHAR(500) NULL AFTER `email_verified_at`;

UPDATE `users`
SET `email_verified` = (`email_verified_at` IS NOT NULL);

-- 2) Credential accounts. Existing Argon2id hashes are copied into Better
-- Auth's credential account because the app keeps Argon2id as Better Auth's
-- configured password implementation.
CREATE TABLE `accounts` (
  `id` VARCHAR(64) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `account_id` VARCHAR(255) NOT NULL,
  `provider_id` VARCHAR(100) NOT NULL,
  `access_token` TEXT NULL,
  `refresh_token` TEXT NULL,
  `access_token_expires_at` DATETIME(3) NULL,
  `refresh_token_expires_at` DATETIME(3) NULL,
  `scope` TEXT NULL,
  `id_token` TEXT NULL,
  `password` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `uq_accounts_provider_account` (`provider_id`, `account_id`),
  INDEX `idx_accounts_user` (`user_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `accounts_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `accounts` (
  `id`, `user_id`, `account_id`, `provider_id`, `password`, `created_at`, `updated_at`
)
SELECT
  UUID(),
  `id`,
  CAST(`id` AS CHAR),
  'credential',
  `password_hash`,
  `created_at`,
  `updated_at`
FROM `users`
WHERE `password_hash` IS NOT NULL;

-- 3) Better Auth sessions. Old hash-only sessions are deliberately invalidated.
DROP TABLE `sessions`;

CREATE TABLE `sessions` (
  `id` VARCHAR(64) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `token` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `sessions_token_key` (`token`),
  INDEX `idx_sessions_user_expiry` (`user_id`, `expires_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `sessions_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 4) Better Auth verification store. Existing one-time custom tokens are not
-- migrated; users simply request a fresh reset/verification link.
DROP TABLE `verification_tokens`;

CREATE TABLE `verifications` (
  `id` VARCHAR(64) NOT NULL,
  `identifier` VARCHAR(255) NOT NULL,
  `value` TEXT NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `idx_verification_identifier` (`identifier`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 5) Remove legacy auth fields after their data has been migrated.
ALTER TABLE `users`
  DROP COLUMN `password_hash`,
  DROP COLUMN `email_verified_at`;

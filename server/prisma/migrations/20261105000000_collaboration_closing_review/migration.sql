ALTER TABLE `users`
    ADD COLUMN `totp_secret_ciphertext` TEXT NULL,
    ADD COLUMN `totp_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `totp_last_used_step` BIGINT NULL;

ALTER TABLE `collaboration_deals`
    MODIFY `status` ENUM('DECLARED', 'ACCESS_REQUESTED', 'IN_PROGRESS', 'CLOSING_REPORTED', 'CLIENT_CONFIRMED', 'CONFIRMED_BY_CLIENT', 'NO_RESPONSE', 'CONFIRMED', 'CONTRACT_SIGNED', 'COMMISSIONS_PAID', 'LOST', 'REJECTED', 'DISPUTED', 'EXPIRED') NOT NULL DEFAULT 'DECLARED',
    ADD COLUMN `lost_reason` ENUM('NO_INTEREST', 'UNREACHABLE', 'NO_BUDGET', 'COMPETITOR_SELECTED', 'CLIENT_CANCELLED', 'DUPLICATE', 'OTHER') NULL,
    ADD COLUMN `dispute_reason` TEXT NULL,
    ADD COLUMN `client_confirmed_at` DATETIME(3) NULL,
    ADD COLUMN `client_confirmation_override_reason` TEXT NULL,
    ADD COLUMN `legacy_backfill_batch_id` CHAR(36) NULL;

ALTER TABLE `collaboration_closing_reports`
    MODIFY `sale_amount` BIGINT NULL,
    MODIFY `details` TEXT NULL,
    ADD COLUMN `status` ENUM('DRAFT', 'SUBMITTED') NOT NULL DEFAULT 'SUBMITTED',
    ADD COLUMN `sale_date` DATETIME(3) NULL,
    ADD COLUMN `idempotency_key` VARCHAR(100) NULL,
    ADD COLUMN `submitted_at` DATETIME(3) NULL;

UPDATE `collaboration_closing_reports`
SET `submitted_at` = `reported_at`
WHERE `status` = 'SUBMITTED';

ALTER TABLE `collaboration_closing_reports`
    MODIFY `status` ENUM('DRAFT', 'SUBMITTED') NOT NULL DEFAULT 'DRAFT',
    ADD UNIQUE INDEX `collaboration_closing_reports_deal_id_key`(`deal_id`),
    ADD UNIQUE INDEX `collaboration_closing_reports_idempotency_key_key`(`idempotency_key`);

CREATE TABLE `collaboration_closing_supplements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `closing_report_id` INTEGER NOT NULL,
    `author_id` INTEGER NOT NULL,
    `details` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `collab_closing_supp_report_created_idx`(`closing_report_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `collaboration_closing_supplements`
    ADD CONSTRAINT `collaboration_closing_supplements_closing_report_id_fkey` FOREIGN KEY (`closing_report_id`) REFERENCES `collaboration_closing_reports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `collaboration_closing_supplements_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `collaboration_client_confirmations`
    MODIFY `status` ENUM('PENDING', 'CONFIRMED', 'CONFIRMED_BY_CLIENT', 'DENIED', 'NO_RESPONSE') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `blocked_until` DATETIME(3) NULL;

ALTER TABLE `collaboration_evidence`
    MODIFY `type` ENUM('CLOSING_REPORT', 'CLOSING_ATTACHMENT', 'CONTRACT') NOT NULL,
    ADD COLUMN `closing_report_id` INTEGER NULL,
    ADD INDEX `collaboration_evidence_closing_report_id_idx`(`closing_report_id`),
    ADD CONSTRAINT `collaboration_evidence_closing_report_id_fkey` FOREIGN KEY (`closing_report_id`) REFERENCES `collaboration_closing_reports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `collaboration_email_jobs`
    MODIFY `type` ENUM('ACCESS_REQUESTED', 'ACCESS_REQUEST_REMINDER', 'ACCESS_REQUEST_EXPIRED', 'ACCESS_REQUEST_REJECTED', 'ACCESS_REQUEST_NOT_SELECTED', 'ACCESS_GRANTED', 'ACCESS_EXPIRED', 'CLIENT_CONFIRMATION_CODE') NOT NULL;

CREATE TABLE `collaboration_audit_heads` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `head_hash` CHAR(64) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `collaboration_audit_heads` (`id`, `head_hash`, `updated_at`)
VALUES (1, NULL, CURRENT_TIMESTAMP(3));

CREATE TABLE `collaboration_rate_limit_buckets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bucket_key` CHAR(64) NOT NULL,
    `window_started_at` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `blocked_until` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `collaboration_rate_limit_buckets_bucket_key_key`(`bucket_key`),
    INDEX `collaboration_rate_limit_buckets_window_started_at_idx`(`window_started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `collaboration_scheduler_locks` (
    `name` VARCHAR(100) NOT NULL,
    `owner_token` CHAR(64) NULL,
    `expires_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `collaboration_sale_counters` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `last_value` BIGINT NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `collaboration_sale_counters` (`id`, `last_value`, `updated_at`)
VALUES (1, 0, CURRENT_TIMESTAMP(3));

CREATE TABLE `collaboration_domain_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deal_id` INTEGER NOT NULL,
    `event_type` VARCHAR(100) NOT NULL,
    `payload` JSON NOT NULL,
    `idempotency_key` VARCHAR(180) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `consumed_at` DATETIME(3) NULL,

    UNIQUE INDEX `collaboration_domain_events_idempotency_key_key`(`idempotency_key`),
    INDEX `collab_domain_events_type_consumed_created_idx`(`event_type`, `consumed_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `collaboration_domain_events`
    ADD CONSTRAINT `collaboration_domain_events_deal_id_fkey` FOREIGN KEY (`deal_id`) REFERENCES `collaboration_deals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

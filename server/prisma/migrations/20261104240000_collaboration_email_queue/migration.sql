CREATE TABLE `collaboration_email_jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deal_id` INTEGER NULL,
    `type` ENUM('ACCESS_REQUESTED', 'ACCESS_REQUEST_REMINDER', 'ACCESS_REQUEST_EXPIRED', 'ACCESS_REQUEST_REJECTED', 'ACCESS_REQUEST_NOT_SELECTED', 'ACCESS_GRANTED', 'ACCESS_EXPIRED') NOT NULL,
    `status` ENUM('QUEUED', 'SENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `recipient_ciphertext` TEXT NOT NULL,
    `payload` JSON NOT NULL,
    `idempotency_key` VARCHAR(180) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `locked_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `last_error` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `collaboration_email_jobs_idempotency_key_key`(`idempotency_key`),
    INDEX `collaboration_email_jobs_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    INDEX `collaboration_email_jobs_deal_id_created_at_idx`(`deal_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `collaboration_email_jobs`
    ADD CONSTRAINT `collaboration_email_jobs_deal_id_fkey` FOREIGN KEY (`deal_id`) REFERENCES `collaboration_deals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

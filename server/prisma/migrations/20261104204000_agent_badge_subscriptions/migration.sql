CREATE TABLE `subscription_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `amount` INTEGER NOT NULL,
    `transaction_ref` VARCHAR(150) NOT NULL,
    `proof_filename` VARCHAR(100) NOT NULL,
    `proof_mime_type` VARCHAR(100) NOT NULL,
    `rejection_reason` TEXT NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_at` DATETIME(3) NULL,
    `reviewed_by` INTEGER NULL,
    `starts_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,

    INDEX `subscription_requests_user_id_status_idx`(`user_id`, `status`),
    INDEX `subscription_requests_status_requested_at_idx`(`status`, `requested_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `subscription_requests`
    ADD CONSTRAINT `subscription_requests_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `subscription_requests`
    ADD CONSTRAINT `subscription_requests_reviewed_by_fkey`
    FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

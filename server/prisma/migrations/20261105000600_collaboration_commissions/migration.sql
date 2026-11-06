ALTER TABLE `collaboration_commissions`
    MODIFY `status` ENUM('PENDING', 'PAID', 'CANCELLED', 'ON_HOLD') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `currency` VARCHAR(8) NOT NULL DEFAULT 'Ar',
    ADD COLUMN `payment_mode` ENUM('MVOLA', 'ORANGE_MONEY', 'AIRTEL_MONEY', 'BANK_TRANSFER', 'CASH') NULL,
    ADD COLUMN `pending_alerted_at` DATETIME(3) NULL,
    ADD UNIQUE INDEX `collaboration_commissions_payment_reference_key`(`payment_reference`);

ALTER TABLE `collaboration_evidence`
    MODIFY `type` ENUM('CLOSING_REPORT', 'CLOSING_ATTACHMENT', 'CONTRACT', 'COMMISSION_PAYMENT') NOT NULL,
    ADD COLUMN `commission_id` INTEGER NULL,
    ADD UNIQUE INDEX `collaboration_evidence_commission_id_key`(`commission_id`),
    ADD CONSTRAINT `collaboration_evidence_commission_id_fkey`
        FOREIGN KEY (`commission_id`) REFERENCES `collaboration_commissions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `collaboration_email_jobs`
    MODIFY `type` ENUM(
        'ACCESS_REQUESTED',
        'ACCESS_REQUEST_REMINDER',
        'ACCESS_REQUEST_EXPIRED',
        'ACCESS_REQUEST_REJECTED',
        'ACCESS_REQUEST_NOT_SELECTED',
        'ACCESS_GRANTED',
        'ACCESS_EXPIRED',
        'CLIENT_CONFIRMATION_CODE',
        'COMMISSION_PAID'
    ) NOT NULL;

CREATE TABLE `collaboration_commission_adjustments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `commission_id` INTEGER NOT NULL,
    `author_id` INTEGER NOT NULL,
    `amount` BIGINT NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'Ar',
    `reason` TEXT NOT NULL,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `collaboration_commission_adjustments_idempotency_key_key`(`idempotency_key`),
    INDEX `collab_commission_adj_commission_created_idx`(`commission_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `collaboration_commission_adjustments`
    ADD CONSTRAINT `collaboration_commission_adjustments_commission_id_fkey`
        FOREIGN KEY (`commission_id`) REFERENCES `collaboration_commissions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `collaboration_commission_adjustments_author_id_fkey`
        FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `collaboration_domain_events`
    ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `last_error` VARCHAR(1000) NULL,
    ADD COLUMN `last_alerted_at` DATETIME(3) NULL;

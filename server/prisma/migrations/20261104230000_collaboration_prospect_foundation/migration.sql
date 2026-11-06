CREATE TABLE `collaboration_deals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `report_id` INTEGER NOT NULL,
    `supplier_id` INTEGER NOT NULL,
    `closer_id` INTEGER NULL,
    `status` ENUM('DECLARED', 'ACCESS_REQUESTED', 'IN_PROGRESS', 'CLOSING_REPORTED', 'CLIENT_CONFIRMED', 'NO_RESPONSE', 'CONFIRMED', 'CONTRACT_SIGNED', 'COMMISSIONS_PAID', 'LOST', 'REJECTED', 'DISPUTED', 'EXPIRED') NOT NULL DEFAULT 'DECLARED',
    `declared_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `access_granted_at` DATETIME(3) NULL,
    `access_expires_at` DATETIME(3) NULL,
    `closing_reported_at` DATETIME(3) NULL,
    `confirmed_at` DATETIME(3) NULL,
    `contract_signed_at` DATETIME(3) NULL,
    `contract_reference` VARCHAR(150) NULL,
    `contract_file_sha256` CHAR(64) NULL,
    `sale_number` VARCHAR(40) NULL,
    `reviewed_by` INTEGER NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `collaboration_deals_report_id_key`(`report_id`),
    UNIQUE INDEX `collaboration_deals_sale_number_key`(`sale_number`),
    INDEX `collaboration_deals_supplier_id_status_created_at_idx`(`supplier_id`, `status`, `created_at`),
    INDEX `collaboration_deals_closer_id_status_idx`(`closer_id`, `status`),
    INDEX `collaboration_deals_status_access_expires_at_idx`(`status`, `access_expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `collaboration_prospect_secrets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deal_id` INTEGER NOT NULL,
    `company_name_ciphertext` TEXT NOT NULL,
    `contact_name_ciphertext` TEXT NOT NULL,
    `phone_ciphertext` TEXT NOT NULL,
    `email_ciphertext` TEXT NULL,
    `address_ciphertext` TEXT NULL,
    `company_name_hash` CHAR(64) NOT NULL,
    `phone_hash` CHAR(64) NOT NULL,
    `email_hash` CHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `collaboration_prospect_secrets_deal_id_key`(`deal_id`),
    INDEX `collaboration_prospect_secrets_company_name_hash_idx`(`company_name_hash`),
    INDEX `collaboration_prospect_secrets_phone_hash_idx`(`phone_hash`),
    INDEX `collaboration_prospect_secrets_email_hash_idx`(`email_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `collaboration_access_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deal_id` INTEGER NOT NULL,
    `requester_id` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED', 'NOT_SELECTED') NOT NULL DEFAULT 'PENDING',
    `pending_key` VARCHAR(80) NULL,
    `message` VARCHAR(500) NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `reminder_sent_at` DATETIME(3) NULL,
    `decided_at` DATETIME(3) NULL,
    `decided_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `collaboration_access_requests_pending_key_key`(`pending_key`),
    INDEX `collaboration_access_requests_deal_id_status_expires_at_idx`(`deal_id`, `status`, `expires_at`),
    INDEX `collaboration_access_requests_requester_id_deal_id_requested_idx`(`requester_id`, `deal_id`, `requested_at`),
    INDEX `collaboration_access_requests_status_expires_at_reminder_sen_idx`(`status`, `expires_at`, `reminder_sent_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `collaboration_deal_status_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deal_id` INTEGER NOT NULL,
    `from_status` ENUM('DECLARED', 'ACCESS_REQUESTED', 'IN_PROGRESS', 'CLOSING_REPORTED', 'CLIENT_CONFIRMED', 'NO_RESPONSE', 'CONFIRMED', 'CONTRACT_SIGNED', 'COMMISSIONS_PAID', 'LOST', 'REJECTED', 'DISPUTED', 'EXPIRED') NULL,
    `to_status` ENUM('DECLARED', 'ACCESS_REQUESTED', 'IN_PROGRESS', 'CLOSING_REPORTED', 'CLIENT_CONFIRMED', 'NO_RESPONSE', 'CONFIRMED', 'CONTRACT_SIGNED', 'COMMISSIONS_PAID', 'LOST', 'REJECTED', 'DISPUTED', 'EXPIRED') NOT NULL,
    `changed_by` INTEGER NULL,
    `comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `collaboration_deal_status_history_deal_id_created_at_idx`(`deal_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `collaboration_closing_reports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deal_id` INTEGER NOT NULL,
    `closer_id` INTEGER NOT NULL,
    `sale_amount` BIGINT NOT NULL,
    `details` TEXT NOT NULL,
    `reported_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_at` DATETIME(3) NULL,
    `rejection_reason` TEXT NULL,

    INDEX `collaboration_closing_reports_deal_id_reported_at_idx`(`deal_id`, `reported_at`),
    INDEX `collaboration_closing_reports_closer_id_reported_at_idx`(`closer_id`, `reported_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `collaboration_client_confirmations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deal_id` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'DENIED', 'NO_RESPONSE') NOT NULL DEFAULT 'PENDING',
    `code_hash` CHAR(64) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expires_at` DATETIME(3) NOT NULL,
    `sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `responded_at` DATETIME(3) NULL,

    UNIQUE INDEX `collaboration_client_confirmations_deal_id_key`(`deal_id`),
    INDEX `collaboration_client_confirmations_status_expires_at_idx`(`status`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `collaboration_evidence` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deal_id` INTEGER NOT NULL,
    `uploaded_by` INTEGER NOT NULL,
    `type` ENUM('CLOSING_REPORT', 'CONTRACT') NOT NULL,
    `storage_key` VARCHAR(255) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `file_size` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `collaboration_evidence_storage_key_key`(`storage_key`),
    INDEX `collaboration_evidence_deal_id_type_created_at_idx`(`deal_id`, `type`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `collaboration_commissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deal_id` INTEGER NOT NULL,
    `agent_id` INTEGER NOT NULL,
    `role` ENUM('SUPPLIER', 'CLOSER') NOT NULL,
    `amount` BIGINT NOT NULL,
    `status` ENUM('PENDING', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `payment_reference` VARCHAR(150) NULL,
    `paid_by` INTEGER NULL,
    `generated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `paid_at` DATETIME(3) NULL,

    INDEX `collaboration_commissions_agent_id_status_generated_at_idx`(`agent_id`, `status`, `generated_at`),
    INDEX `collaboration_commissions_status_generated_at_idx`(`status`, `generated_at`),
    UNIQUE INDEX `collaboration_commissions_deal_id_role_key`(`deal_id`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `collaboration_audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actor_id` INTEGER NULL,
    `deal_id` INTEGER NULL,
    `action` VARCHAR(100) NOT NULL,
    `entity_type` VARCHAR(80) NOT NULL,
    `entity_id` INTEGER NULL,
    `metadata` JSON NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(500) NULL,
    `previous_hash` CHAR(64) NULL,
    `entry_hash` CHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `collaboration_audit_logs_entry_hash_key`(`entry_hash`),
    INDEX `collaboration_audit_logs_deal_id_created_at_idx`(`deal_id`, `created_at`),
    INDEX `collaboration_audit_logs_actor_id_created_at_idx`(`actor_id`, `created_at`),
    INDEX `collaboration_audit_logs_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `collaboration_deals`
    ADD CONSTRAINT `collaboration_deals_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `collaboration_deals_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `collaboration_deals_closer_id_fkey` FOREIGN KEY (`closer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `collaboration_deals_reviewed_by_fkey` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `collaboration_prospect_secrets`
    ADD CONSTRAINT `collaboration_prospect_secrets_deal_id_fkey` FOREIGN KEY (`deal_id`) REFERENCES `collaboration_deals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `collaboration_access_requests`
    ADD CONSTRAINT `collaboration_access_requests_deal_id_fkey` FOREIGN KEY (`deal_id`) REFERENCES `collaboration_deals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `collaboration_access_requests_requester_id_fkey` FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `collaboration_access_requests_decided_by_fkey` FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `collaboration_deal_status_history`
    ADD CONSTRAINT `collaboration_deal_status_history_deal_id_fkey` FOREIGN KEY (`deal_id`) REFERENCES `collaboration_deals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `collaboration_deal_status_history_changed_by_fkey` FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `collaboration_closing_reports`
    ADD CONSTRAINT `collaboration_closing_reports_deal_id_fkey` FOREIGN KEY (`deal_id`) REFERENCES `collaboration_deals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `collaboration_closing_reports_closer_id_fkey` FOREIGN KEY (`closer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `collaboration_client_confirmations`
    ADD CONSTRAINT `collaboration_client_confirmations_deal_id_fkey` FOREIGN KEY (`deal_id`) REFERENCES `collaboration_deals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `collaboration_evidence`
    ADD CONSTRAINT `collaboration_evidence_deal_id_fkey` FOREIGN KEY (`deal_id`) REFERENCES `collaboration_deals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `collaboration_evidence_uploaded_by_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `collaboration_commissions`
    ADD CONSTRAINT `collaboration_commissions_deal_id_fkey` FOREIGN KEY (`deal_id`) REFERENCES `collaboration_deals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `collaboration_commissions_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `collaboration_commissions_paid_by_fkey` FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `collaboration_audit_logs`
    ADD CONSTRAINT `collaboration_audit_logs_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `collaboration_audit_logs_deal_id_fkey` FOREIGN KEY (`deal_id`) REFERENCES `collaboration_deals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `collaboration_audit_logs`
    ADD COLUMN `sequence` BIGINT NULL,
    ADD COLUMN `chain_version` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `actor_role` VARCHAR(20) NULL,
    ADD COLUMN `old_values` JSON NULL,
    ADD COLUMN `new_values` JSON NULL,
    ADD COLUMN `occurred_at_local` VARCHAR(40) NULL;

SET @collaboration_audit_sequence := 0;
UPDATE `collaboration_audit_logs`
SET `sequence` = (@collaboration_audit_sequence := @collaboration_audit_sequence + 1)
ORDER BY `id`;

ALTER TABLE `collaboration_audit_logs`
    MODIFY COLUMN `sequence` BIGINT NOT NULL,
    ADD UNIQUE INDEX `collaboration_audit_logs_sequence_key`(`sequence`),
    ADD INDEX `collaboration_audit_logs_action_created_at_idx`(`action`, `created_at`);

ALTER TABLE `collaboration_audit_heads`
    ADD COLUMN `sequence` BIGINT NOT NULL DEFAULT 0;

UPDATE `collaboration_audit_heads`
SET `sequence` = (SELECT COUNT(*) FROM `collaboration_audit_logs`);

CREATE TRIGGER `collaboration_audit_logs_no_update`
BEFORE UPDATE ON `collaboration_audit_logs`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Collaboration audit entries are append-only';

CREATE TRIGGER `collaboration_audit_logs_no_delete`
BEFORE DELETE ON `collaboration_audit_logs`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Collaboration audit entries are append-only';

CREATE TABLE `collaboration_prospect_hash_claims` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contact_type` VARCHAR(8) NOT NULL,
    `contact_hash` CHAR(64) NOT NULL,
    `deal_id` INTEGER NOT NULL,
    `supplier_id` INTEGER NOT NULL,
    `claimed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `collaboration_prospect_hash_claims_contact_type_contact_hash_key`(`contact_type`, `contact_hash`),
    INDEX `collaboration_prospect_hash_claims_deal_id_idx`(`deal_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `collaboration_prospect_hash_claims`
    ADD CONSTRAINT `collaboration_prospect_hash_claims_deal_id_fkey`
        FOREIGN KEY (`deal_id`) REFERENCES `collaboration_deals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `collaboration_prospect_hash_claims_supplier_id_fkey`
        FOREIGN KEY (`supplier_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `collaboration_prospect_hash_claims`
    (`contact_type`, `contact_hash`, `deal_id`, `supplier_id`, `claimed_at`)
SELECT 'PHONE', secret.`phone_hash`, deal.`id`, deal.`supplier_id`, deal.`declared_at`
FROM `collaboration_prospect_secrets` AS secret
JOIN `collaboration_deals` AS deal ON deal.`id` = secret.`deal_id`
ORDER BY deal.`declared_at`, deal.`id`;

INSERT IGNORE INTO `collaboration_prospect_hash_claims`
    (`contact_type`, `contact_hash`, `deal_id`, `supplier_id`, `claimed_at`)
SELECT 'EMAIL', secret.`email_hash`, deal.`id`, deal.`supplier_id`, deal.`declared_at`
FROM `collaboration_prospect_secrets` AS secret
JOIN `collaboration_deals` AS deal ON deal.`id` = secret.`deal_id`
WHERE secret.`email_hash` IS NOT NULL
ORDER BY deal.`declared_at`, deal.`id`;

CREATE TABLE `collaboration_contact_access_counters` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` INTEGER NOT NULL,
    `day` DATE NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `daily_alerted_at` DATETIME(3) NULL,
    `burst_alerted_at` DATETIME(3) NULL,

    UNIQUE INDEX `collaboration_contact_access_counters_agent_id_day_key`(`agent_id`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `collaboration_contact_access_counters`
    ADD CONSTRAINT `collaboration_contact_access_counters_agent_id_fkey`
        FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `collaboration_trust_score_snapshots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` INTEGER NOT NULL,
    `score_day` DATE NOT NULL,
    `score` INTEGER NOT NULL,
    `formula_version` INTEGER NOT NULL DEFAULT 1,
    `components` JSON NOT NULL,
    `calculated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `collaboration_trust_score_snapshots_agent_id_score_day_key`(`agent_id`, `score_day`),
    INDEX `collaboration_trust_score_snapshots_agent_id_calculated_at_idx`(`agent_id`, `calculated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `collaboration_trust_score_snapshots`
    ADD CONSTRAINT `collaboration_trust_score_snapshots_agent_id_fkey`
        FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

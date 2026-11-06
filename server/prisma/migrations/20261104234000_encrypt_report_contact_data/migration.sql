ALTER TABLE `reports`
    DROP INDEX `reports_contact_phone_idx`,
    MODIFY `contact_phone` TEXT NOT NULL,
    MODIFY `contact_email` TEXT NULL,
    MODIFY `address` TEXT NOT NULL,
    ADD COLUMN `contact_phone_hash` CHAR(64) NULL,
    ADD COLUMN `contact_email_hash` CHAR(64) NULL,
    ADD INDEX `reports_contact_phone_hash_idx`(`contact_phone_hash`),
    ADD INDEX `reports_contact_email_hash_idx`(`contact_email_hash`);

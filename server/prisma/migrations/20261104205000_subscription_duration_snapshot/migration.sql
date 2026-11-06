ALTER TABLE `subscription_requests`
    ADD COLUMN `duration_days` INTEGER NOT NULL DEFAULT 30;

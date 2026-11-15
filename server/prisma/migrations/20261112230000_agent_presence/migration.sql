ALTER TABLE `users`
  ADD COLUMN `last_active_at` DATETIME(3) NULL;

UPDATE `users`
SET `last_active_at` = `last_login_at`
WHERE `last_login_at` IS NOT NULL;

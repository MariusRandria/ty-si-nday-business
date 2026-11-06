CREATE TABLE `push_subscriptions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `endpoint` TEXT NOT NULL,
  `endpoint_hash` CHAR(64) NOT NULL,
  `p256dh` VARCHAR(255) NOT NULL,
  `auth` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `push_subscriptions_endpoint_hash_key` (`endpoint_hash`),
  INDEX `push_subscriptions_user_id_idx` (`user_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `push_subscriptions_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

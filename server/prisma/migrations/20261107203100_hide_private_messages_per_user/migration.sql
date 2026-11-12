CREATE TABLE `direct_message_hidden` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `message_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `direct_message_hidden_message_id_user_id_key`(`message_id`, `user_id`),
    INDEX `direct_message_hidden_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `direct_message_hidden`
    ADD CONSTRAINT `direct_message_hidden_message_id_fkey`
    FOREIGN KEY (`message_id`) REFERENCES `direct_messages`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `direct_message_hidden`
    ADD CONSTRAINT `direct_message_hidden_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

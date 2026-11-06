ALTER TABLE `comments`
  ADD COLUMN `parent_comment_id` INTEGER NULL,
  ADD INDEX `comments_parent_comment_id_idx` (`parent_comment_id`),
  ADD CONSTRAINT `comments_parent_comment_id_fkey`
    FOREIGN KEY (`parent_comment_id`) REFERENCES `comments` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `conversations` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `participant_one_id` INTEGER NOT NULL,
  `participant_two_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `conversations_participant_one_id_updated_at_idx` (`participant_one_id`, `updated_at`),
  INDEX `conversations_participant_two_id_updated_at_idx` (`participant_two_id`, `updated_at`),
  UNIQUE INDEX `conversations_participant_one_id_participant_two_id_key` (`participant_one_id`, `participant_two_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `conversations_participant_one_id_fkey`
    FOREIGN KEY (`participant_one_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `conversations_participant_two_id_fkey`
    FOREIGN KEY (`participant_two_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `direct_messages` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `conversation_id` INTEGER NOT NULL,
  `sender_id` INTEGER NOT NULL,
  `content` TEXT NOT NULL,
  `read_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `direct_messages_conversation_id_created_at_idx` (`conversation_id`, `created_at`),
  INDEX `direct_messages_sender_id_read_at_idx` (`sender_id`, `read_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `direct_messages_conversation_id_fkey`
    FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `direct_messages_sender_id_fkey`
    FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

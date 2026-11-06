ALTER TABLE `notifications`
  ADD COLUMN `actor_id` INTEGER NULL,
  ADD INDEX `notifications_actor_id_idx` (`actor_id`),
  ADD CONSTRAINT `notifications_actor_id_fkey`
    FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `collaboration_deals`
  ADD COLUMN `review_assigned_to_id` INTEGER NULL,
  ADD COLUMN `sign_assigned_to_id` INTEGER NULL,
  ADD INDEX `collaboration_deals_review_assigned_to_id_status_idx` (`review_assigned_to_id`, `status`),
  ADD INDEX `collaboration_deals_sign_assigned_to_id_status_idx` (`sign_assigned_to_id`, `status`),
  ADD CONSTRAINT `collaboration_deals_review_assigned_to_id_fkey`
    FOREIGN KEY (`review_assigned_to_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `collaboration_deals_sign_assigned_to_id_fkey`
    FOREIGN KEY (`sign_assigned_to_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

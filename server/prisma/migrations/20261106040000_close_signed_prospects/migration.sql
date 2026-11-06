ALTER TABLE `collaboration_access_requests`
  MODIFY `status` ENUM('PENDING', 'CLOSED_SIGNED', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED', 'NOT_SELECTED') NOT NULL DEFAULT 'PENDING';

ALTER TABLE `collaboration_email_jobs`
  MODIFY `status` ENUM('QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED';

CREATE TABLE `collaboration_hidden_deals` (
  `deal_id` INTEGER NOT NULL,
  `agent_id` INTEGER NOT NULL,
  `hidden_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `collaboration_hidden_deals_agent_id_hidden_at_idx` (`agent_id`, `hidden_at`),
  PRIMARY KEY (`deal_id`, `agent_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `collaboration_hidden_deals`
  ADD CONSTRAINT `collaboration_hidden_deals_deal_id_fkey`
    FOREIGN KEY (`deal_id`) REFERENCES `collaboration_deals` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `collaboration_hidden_deals_agent_id_fkey`
    FOREIGN KEY (`agent_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

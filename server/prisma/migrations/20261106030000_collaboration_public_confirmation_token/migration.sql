ALTER TABLE `collaboration_client_confirmations`
  ADD COLUMN `public_token_hash` CHAR(64) NULL;

UPDATE `collaboration_client_confirmations`
SET `public_token_hash` = SHA2(CONCAT(UUID(), ':', RAND(), ':', `id`), 256)
WHERE `public_token_hash` IS NULL;

ALTER TABLE `collaboration_client_confirmations`
  MODIFY COLUMN `public_token_hash` CHAR(64) NOT NULL;

CREATE UNIQUE INDEX `collab_client_conf_public_token_key`
  ON `collaboration_client_confirmations` (`public_token_hash`);

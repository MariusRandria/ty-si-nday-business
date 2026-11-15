ALTER TABLE `conversations`
  ADD COLUMN `participant_one_archived_at` DATETIME(3) NULL,
  ADD COLUMN `participant_two_archived_at` DATETIME(3) NULL,
  ADD COLUMN `participant_one_deleted_at` DATETIME(3) NULL,
  ADD COLUMN `participant_two_deleted_at` DATETIME(3) NULL;

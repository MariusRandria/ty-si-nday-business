ALTER TABLE `direct_messages`
    ADD COLUMN `media_storage_key` VARCHAR(100) NULL,
    ADD COLUMN `media_mime_type` VARCHAR(100) NULL;

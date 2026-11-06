CREATE TABLE `prospect_contacts` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `company_name` VARCHAR(200) NOT NULL,
  `responsible_name` VARCHAR(150) NULL,
  `latitude` DOUBLE NULL,
  `longitude` DOUBLE NULL,
  `address` VARCHAR(500) NULL,
  `contact` VARCHAR(255) NULL,
  `created_by` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `prospect_contacts_created_at_idx` (`created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `prospect_contacts_created_by_fkey`
    FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

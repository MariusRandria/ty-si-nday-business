-- AlterTable
ALTER TABLE `marketplace_orders` ADD COLUMN `cancellation_reason` VARCHAR(255) NULL,
    ADD COLUMN `delivery_fee` BIGINT NULL,
    ADD COLUMN `items_amount` BIGINT NULL,
    ADD COLUMN `payment_account` VARCHAR(100) NULL,
    ADD COLUMN `payment_account_name` VARCHAR(150) NULL,
    ADD COLUMN `payment_expires_at` DATETIME(3) NULL,
    ADD COLUMN `payment_instructions` TEXT NULL,
    ADD COLUMN `payment_method` ENUM('MVOLA', 'ORANGE_MONEY', 'AIRTEL_MONEY', 'ESPECES') NULL,
    ADD COLUMN `quoted_at` DATETIME(3) NULL,
    MODIFY `total_amount` BIGINT NULL;

UPDATE `marketplace_orders`
SET `items_amount` = `total_amount`,
    `delivery_fee` = CASE
      WHEN `delivery_method` = 'RECUPERATION'
        OR `payment_status` = 'PAYE'
        OR `status` = 'ANNULEE' THEN 0
      ELSE NULL
    END,
    `total_amount` = CASE
      WHEN `delivery_method` <> 'RECUPERATION'
        AND `payment_status` <> 'PAYE'
        AND `status` <> 'ANNULEE' THEN NULL
      ELSE `total_amount`
    END,
    `quoted_at` = CASE
      WHEN `delivery_method` = 'RECUPERATION'
        OR `payment_status` = 'PAYE'
        OR `status` = 'ANNULEE' THEN COALESCE(`paid_at`, `created_at`)
      ELSE NULL
    END,
    `payment_expires_at` = CASE
      WHEN `delivery_method` = 'RECUPERATION'
        AND `payment_status` = 'A_CONFIRMER'
        AND `status` <> 'ANNULEE' THEN DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
      ELSE NULL
    END;

ALTER TABLE `marketplace_orders` MODIFY `items_amount` BIGINT NOT NULL;

-- CreateTable
CREATE TABLE `marketplace_payment_settings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `mvola_number` VARCHAR(100) NULL,
    `mvola_account_name` VARCHAR(150) NULL,
    `orange_money_number` VARCHAR(100) NULL,
    `orange_money_name` VARCHAR(150) NULL,
    `airtel_money_number` VARCHAR(100) NULL,
    `airtel_money_name` VARCHAR(150) NULL,
    `instructions` TEXT NOT NULL DEFAULT '',
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `marketplace_orders_payment_status_payment_expires_at_idx` ON `marketplace_orders`(`payment_status`, `payment_expires_at`);

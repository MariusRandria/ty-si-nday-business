ALTER TABLE `marketplace_orders`
  ADD COLUMN `quote_expires_at` DATETIME(3) NULL,
  ADD INDEX `marketplace_orders_payment_status_quote_expires_at_idx` (`payment_status`, `quote_expires_at`);

UPDATE `marketplace_orders`
SET `quote_expires_at` = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
WHERE `total_amount` IS NULL
  AND `payment_status` = 'A_CONFIRMER'
  AND `status` NOT IN ('ANNULEE', 'EXPEDIEE', 'LIVREE')
  AND `delivery_method` <> 'RECUPERATION';

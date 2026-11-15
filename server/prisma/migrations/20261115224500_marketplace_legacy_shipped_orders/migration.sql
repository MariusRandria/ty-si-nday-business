UPDATE `marketplace_orders`
SET `delivery_fee` = 0,
    `total_amount` = `items_amount`,
    `quoted_at` = COALESCE(`quoted_at`, `updated_at`, `created_at`),
    `quote_expires_at` = NULL,
    `payment_expires_at` = NULL
WHERE `total_amount` IS NULL
  AND `payment_status` = 'A_CONFIRMER'
  AND `status` IN ('EXPEDIEE', 'LIVREE')
  AND `delivery_method` <> 'RECUPERATION';

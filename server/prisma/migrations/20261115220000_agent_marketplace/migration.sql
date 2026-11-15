CREATE TABLE `marketplace_products` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(200) NOT NULL,
  `category` VARCHAR(100) NOT NULL,
  `description` TEXT NOT NULL,
  `price` BIGINT NOT NULL,
  `image_url` VARCHAR(500) NULL,
  `status` ENUM('BROUILLON', 'PUBLIE', 'ARCHIVE') NOT NULL DEFAULT 'BROUILLON',
  `published_at` DATETIME(3) NULL,
  `created_by` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `marketplace_products_status_created_at_idx` (`status`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `marketplace_products_created_by_fkey`
    FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `marketplace_product_variants` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `product_id` INTEGER NOT NULL,
  `label` VARCHAR(100) NOT NULL,
  `stock` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `marketplace_product_variants_product_id_label_key` (`product_id`, `label`),
  INDEX `marketplace_product_variants_product_id_is_active_idx` (`product_id`, `is_active`),
  PRIMARY KEY (`id`),
  CONSTRAINT `marketplace_product_variants_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `marketplace_products`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `marketplace_orders` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `agent_id` INTEGER NOT NULL,
  `status` ENUM('DEMANDEE', 'CONFIRMEE', 'EN_PREPARATION', 'PRETE', 'EXPEDIEE', 'LIVREE', 'ANNULEE') NOT NULL DEFAULT 'DEMANDEE',
  `payment_status` ENUM('A_CONFIRMER', 'PAYE') NOT NULL DEFAULT 'A_CONFIRMER',
  `delivery_method` ENUM('LIVRAISON', 'COLIS', 'RECUPERATION') NOT NULL,
  `delivery_address` TEXT NULL,
  `agent_note` TEXT NULL,
  `total_amount` BIGINT NOT NULL,
  `payment_reference` VARCHAR(100) NULL,
  `paid_by_id` INTEGER NULL,
  `paid_at` DATETIME(3) NULL,
  `updated_by_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `marketplace_orders_agent_id_created_at_idx` (`agent_id`, `created_at`),
  INDEX `marketplace_orders_status_created_at_idx` (`status`, `created_at`),
  INDEX `marketplace_orders_payment_status_created_at_idx` (`payment_status`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `marketplace_orders_agent_id_fkey`
    FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `marketplace_orders_paid_by_id_fkey`
    FOREIGN KEY (`paid_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `marketplace_orders_updated_by_id_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `marketplace_order_items` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `order_id` INTEGER NOT NULL,
  `product_id` INTEGER NULL,
  `variant_id` INTEGER NULL,
  `product_name` VARCHAR(200) NOT NULL,
  `variant_label` VARCHAR(100) NOT NULL,
  `quantity` INTEGER NOT NULL,
  `unit_price` BIGINT NOT NULL,
  `line_total` BIGINT NOT NULL,
  INDEX `marketplace_order_items_order_id_idx` (`order_id`),
  INDEX `marketplace_order_items_product_id_idx` (`product_id`),
  INDEX `marketplace_order_items_variant_id_idx` (`variant_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `marketplace_order_items_order_id_fkey`
    FOREIGN KEY (`order_id`) REFERENCES `marketplace_orders`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `marketplace_order_items_product_id_fkey`
    FOREIGN KEY (`product_id`) REFERENCES `marketplace_products`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `marketplace_order_items_variant_id_fkey`
    FOREIGN KEY (`variant_id`) REFERENCES `marketplace_product_variants`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `collaboration_deal_status_history`
    (`deal_id`, `from_status`, `to_status`, `changed_by`, `comment`, `created_at`)
SELECT
    deal.`id`,
    deal.`status`,
    'COMMISSIONS_PAID',
    NULL,
    'Les deux commissions ont été créditées aux portefeuilles des agents.',
    CURRENT_TIMESTAMP(3)
FROM `collaboration_deals` AS deal
WHERE deal.`status` = 'CONTRACT_SIGNED'
  AND (
      SELECT COUNT(*)
      FROM `collaboration_commissions` AS commission
      WHERE commission.`deal_id` = deal.`id`
  ) = 2
  AND NOT EXISTS (
      SELECT 1
      FROM `collaboration_commissions` AS commission
      WHERE commission.`deal_id` = deal.`id`
        AND commission.`status` NOT IN ('PENDING', 'PAID')
  );

UPDATE `collaboration_deals` AS deal
SET `status` = 'COMMISSIONS_PAID'
WHERE deal.`status` = 'CONTRACT_SIGNED'
  AND (
      SELECT COUNT(*)
      FROM `collaboration_commissions` AS commission
      WHERE commission.`deal_id` = deal.`id`
  ) = 2
  AND NOT EXISTS (
      SELECT 1
      FROM `collaboration_commissions` AS commission
      WHERE commission.`deal_id` = deal.`id`
        AND commission.`status` NOT IN ('PENDING', 'PAID')
  );

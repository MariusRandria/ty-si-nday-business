ALTER TABLE `collaboration_deal_status_history`
    MODIFY `from_status` ENUM(
        'DECLARED',
        'ACCESS_REQUESTED',
        'IN_PROGRESS',
        'CLOSING_REPORTED',
        'CLIENT_CONFIRMED',
        'CONFIRMED_BY_CLIENT',
        'NO_RESPONSE',
        'CONFIRMED',
        'CONTRACT_SIGNED',
        'COMMISSIONS_PAID',
        'LOST',
        'REJECTED',
        'DISPUTED',
        'EXPIRED'
    ) NULL,
    MODIFY `to_status` ENUM(
        'DECLARED',
        'ACCESS_REQUESTED',
        'IN_PROGRESS',
        'CLOSING_REPORTED',
        'CLIENT_CONFIRMED',
        'CONFIRMED_BY_CLIENT',
        'NO_RESPONSE',
        'CONFIRMED',
        'CONTRACT_SIGNED',
        'COMMISSIONS_PAID',
        'LOST',
        'REJECTED',
        'DISPUTED',
        'EXPIRED'
    ) NOT NULL;

DROP INDEX `collaboration_closing_reports_deal_id_reported_at_idx`
    ON `collaboration_closing_reports`;

ALTER TABLE `agent_profiles`
  DROP COLUMN `external_notifications_enabled`;

ALTER TABLE `applications`
  DROP COLUMN `external_notifications_consent`;

ALTER TABLE `pending_agent_registrations`
  DROP COLUMN `external_notifications_consent`;

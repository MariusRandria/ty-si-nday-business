ALTER TABLE `agent_profiles`
  ADD COLUMN `external_notifications_enabled` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `applications`
  ADD COLUMN `external_notifications_consent` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `pending_agent_registrations`
  ADD COLUMN `external_notifications_consent` BOOLEAN NOT NULL DEFAULT false;

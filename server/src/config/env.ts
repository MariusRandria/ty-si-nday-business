import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';

loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const fallbackJwtSecret = 'dev-only-change-this-secret';
const configuredJwtSecret = process.env.JWT_SECRET ?? process.env.JWT_ACCESS_SECRET ?? process.env.JWT_REFRESH_SECRET;

if (process.env.NODE_ENV === 'production' && (!configuredJwtSecret || configuredJwtSecret.length < 32 || configuredJwtSecret === fallbackJwtSecret)) {
  throw new Error('Production requires a unique JWT secret with at least 32 characters.');
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  clientOrigins: [...new Set([
    ...(process.env.CLIENT_ORIGINS ?? '').split(','),
    process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
  ].map((origin) => origin.trim()).filter(Boolean))],
  agentAppUrl: process.env.AGENT_APP_URL ?? 'http://localhost:5174',
  clientAppUrl: process.env.CLIENT_APP_URL ?? 'http://localhost:5173',
  apiPublicUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:3000',
  collaborationSchedulerEnabled: process.env.COLLABORATION_SCHEDULER_ENABLED !== 'false',
  clientConfirmationRequired: process.env.CLIENT_CONFIRMATION_REQUIRED !== 'false',
  commissionProviderAmount: Number(process.env.COMMISSION_PROVIDER_AMOUNT ?? 50000),
  commissionCloserAmount: Number(process.env.COMMISSION_CLOSER_AMOUNT ?? 100000),
  commissionCurrency: process.env.COMMISSION_CURRENCY ?? 'Ar',
  collaborationContactDailyLimit: Number(process.env.COLLABORATION_CONTACT_DAILY_LIMIT ?? 50),
  contactViewDedupMinutes: Number(process.env.CONTACT_VIEW_DEDUP_MINUTES ?? 5),
  collaborationContactBurstLimit: Number(process.env.COLLABORATION_CONTACT_BURST_LIMIT ?? 10),
  collaborationContactBurstWindowMinutes: Number(process.env.COLLABORATION_CONTACT_BURST_WINDOW_MINUTES ?? 5),
  collaborationContactDeniedAlertThreshold: Number(process.env.COLLABORATION_CONTACT_DENIED_ALERT_THRESHOLD ?? 5),
  collaborationAccessWithoutReportThreshold: Number(process.env.COLLABORATION_ACCESS_WITHOUT_REPORT_THRESHOLD ?? 10),
  collaborationBypassCheckDays: Number(process.env.COLLABORATION_BYPASS_CHECK_DAYS ?? 30),
  collaborationTrustScoreAlertThreshold: Number(process.env.COLLABORATION_TRUST_SCORE_ALERT_THRESHOLD ?? 40),
  collaborationTrustScoreSuspensionProposalThreshold: Number(process.env.COLLABORATION_TRUST_SCORE_SUSPENSION_PROPOSAL_THRESHOLD ?? 20),
  databaseUrl: process.env.DATABASE_URL ?? 'mysql://root:@localhost:3306/cominnovt',
  jwtSecret: configuredJwtSecret ?? fallbackJwtSecret,
  collaborationEncryptionKey: process.env.COLLABORATION_ENCRYPTION_KEY ?? '',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
  smtpFrom: process.env.SMTP_FROM ?? '',
  webPushPublicKey: process.env.WEB_PUSH_PUBLIC_KEY ?? '',
  webPushPrivateKey: process.env.WEB_PUSH_PRIVATE_KEY ?? '',
  webPushSubject: process.env.WEB_PUSH_SUBJECT ?? 'mailto:admin@innovcom.local',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@innovcom.local',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
};

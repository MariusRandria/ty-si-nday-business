import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, Response } from 'express';
import { env } from './config/env.js';
import { applicationRouter } from './modules/applications/application.routes.js';
import { productRouter } from './modules/products/product.routes.js';
import { reportRouter } from './modules/reports/report.routes.js';
import { statsRouter } from './modules/stats/stats.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { requireAdmin, requireAuth } from './modules/auth/auth.middleware.js';
import { workspaceRouter } from './modules/workspace/workspace.routes.js';
import { adminCommunityRouter, communityRouter } from './modules/community/community.routes.js';
import { adminProspectRouter, agentProspectRouter } from './modules/prospects/prospect.routes.js';
import { adminSubscriptionRouter, subscriptionRouter } from './modules/subscriptions/subscription.routes.js';
import { collaborationRouter } from './modules/collaboration/collaboration.routes.js';
import { collaborationAdminRouter } from './modules/collaboration/collaboration.admin.routes.js';
import { collaborationClosingRouter, collaborationPublicRouter } from './modules/collaboration/collaboration.closing.routes.js';
import { collaborationAdminCommissionsRouter, collaborationCommissionsRouter } from './modules/collaboration/collaboration.commissions.routes.js';
import { collaborationAuditAdminRouter } from './modules/collaboration/collaboration.audit.routes.js';

export function createApp() {
  const app = express();
  app.use(helmet({
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'blob:'] } },
  }));
  app.use(cors({ origin: env.clientOrigins }));
  app.use(express.json());
  app.use('/api/uploads/profile-photos', express.static(fileURLToPath(new URL('../uploads/profile-photos/', import.meta.url)), { maxAge: '1y', immutable: true }));
  app.use('/api/uploads/community-images', express.static(fileURLToPath(new URL('../uploads/community-images/', import.meta.url)), { maxAge: '1y', immutable: true, dotfiles: 'deny', index: false }));
  app.get('/api/health', (_request: Request, response: Response) => response.json({ status: 'ok', service: 'innovcom-api' }));
  app.use('/api/auth', authRouter);
  app.use('/api/public/applications', applicationRouter);
  app.use('/api/products', productRouter);
  app.use('/api/collaboration/public', collaborationPublicRouter);
  app.use('/api/reports', requireAuth, reportRouter);
  app.use('/api/stats', requireAuth, statsRouter);
  app.use('/api/workspace', requireAuth, workspaceRouter);
  app.use('/api/community', requireAuth, communityRouter);
  app.use('/api/prospects', requireAuth, agentProspectRouter);
  app.use('/api/subscriptions', requireAuth, subscriptionRouter);
  app.use('/api/collaboration', requireAuth, collaborationRouter);
  app.use('/api/collaboration', requireAuth, collaborationClosingRouter);
  app.use('/api/collaboration/commissions', requireAuth, collaborationCommissionsRouter);
  app.use('/api/admin/collaboration', requireAuth, requireAdmin, collaborationAdminRouter);
  app.use('/api/admin/collaboration/audit', requireAuth, requireAdmin, collaborationAuditAdminRouter);
  app.use('/api/admin/collaboration', requireAuth, requireAdmin, collaborationAdminCommissionsRouter);
  app.use('/api/admin/community', requireAuth, requireAdmin, adminCommunityRouter);
  app.use('/api/admin/prospects', requireAuth, requireAdmin, adminProspectRouter);
  app.use('/api/admin/subscriptions', requireAuth, requireAdmin, adminSubscriptionRouter);
  app.use('/api/admin', requireAuth, requireAdmin, adminRouter);
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error('Unhandled API error:', error);
    response.status(500).json({ error: 'Une erreur interne est survenue. Consultez les logs de l’API.' });
  });
  return app;
}

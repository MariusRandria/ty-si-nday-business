import { Router, type NextFunction, type Response } from 'express';
import { getAdminDashboard, listApplications, resendApplicationApprovalEmail, updateApplication, updateAgentStatus, listReports, updateReport, listWithdrawals, updateWithdrawal } from './admin.controller.js';
import { createProduct, listAdminProducts, updateProductStatus } from '../products/product.controller.js';
import { requireAdminTotp } from '../collaboration/admin-totp.js';
import { collaborationRateLimit } from '../collaboration/collaboration.rate-limit.js';
import type { AuthRequest } from '../auth/auth.middleware.js';

export const adminRouter = Router();
const withdrawalPaymentTotpRateLimit = collaborationRateLimit({
  scope: 'admin-withdrawal-payment-totp',
  limit: 10,
  windowMs: 60_000,
  key: (request) => {
    const adminId = (request as AuthRequest).user?.id;
    return `${adminId ?? 'unknown'}:${request.ip ?? 'unknown'}`;
  },
});

function requireWithdrawalPaymentTotp(request: AuthRequest, response: Response, next: NextFunction) {
  if (request.body?.status !== 'PAYE') {
    next();
    return;
  }
  withdrawalPaymentTotpRateLimit(request, response, () => {
    void requireAdminTotp(request, response, next).catch(next);
  });
}

adminRouter.get('/dashboard', getAdminDashboard);
adminRouter.get('/applications', listApplications);
adminRouter.patch('/applications/:id', updateApplication);
adminRouter.post('/applications/:id/resend-approval-email', resendApplicationApprovalEmail);
adminRouter.patch('/agents/:id/status', collaborationRateLimit({ scope: 'admin-agent-status', limit: 10, windowMs: 60_000 }), requireAdminTotp, updateAgentStatus);
adminRouter.get('/reports', listReports);
adminRouter.patch('/reports/:id', updateReport);
adminRouter.get('/withdrawals', listWithdrawals);
adminRouter.patch('/withdrawals/:id', requireWithdrawalPaymentTotp, updateWithdrawal);
adminRouter.get('/products', listAdminProducts);
adminRouter.post('/products', createProduct);
adminRouter.patch('/products/:id/status', updateProductStatus);

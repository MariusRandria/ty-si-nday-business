import { Router } from 'express';
import { getAdminDashboard, listApplications, resendApplicationApprovalEmail, updateApplication, updateAgentStatus, listReports, updateReport, listWithdrawals, updateWithdrawal } from './admin.controller.js';
import { createProduct, listAdminProducts, updateProductStatus } from '../products/product.controller.js';
import { requireAdminTotp } from '../collaboration/admin-totp.js';
import { collaborationRateLimit } from '../collaboration/collaboration.rate-limit.js';

export const adminRouter = Router();
adminRouter.get('/dashboard', getAdminDashboard);
adminRouter.get('/applications', listApplications);
adminRouter.patch('/applications/:id', updateApplication);
adminRouter.post('/applications/:id/resend-approval-email', resendApplicationApprovalEmail);
adminRouter.patch('/agents/:id/status', collaborationRateLimit({ scope: 'admin-agent-status', limit: 10, windowMs: 60_000 }), requireAdminTotp, updateAgentStatus);
adminRouter.get('/reports', listReports);
adminRouter.patch('/reports/:id', updateReport);
adminRouter.get('/withdrawals', listWithdrawals);
adminRouter.patch('/withdrawals/:id', updateWithdrawal);
adminRouter.get('/products', listAdminProducts);
adminRouter.post('/products', createProduct);
adminRouter.patch('/products/:id/status', updateProductStatus);

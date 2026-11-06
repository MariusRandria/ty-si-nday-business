import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../auth/auth.middleware.js';
import { getAvailableCollaborationCommissionAmount, getTotalCollaborationCommissionAmount, getWithdrawalMinimum } from '../workspace/wallet.service.js';

function walletNumber(amount: bigint, description: string) {
  const value = Number(amount)
  if (!Number.isSafeInteger(value)) throw new Error(`${description} exceeds the supported safe integer range.`)
  return value
}

export async function getAgentStats(request: AuthRequest, response: Response) {
  if (!request.user || request.user.role !== 'AGENT') {
    response.status(403).json({ error: 'Ces statistiques sont réservées à l’agent connecté' });
    return;
  }
  const agentId = request.user.id;
  const [reports, gains, collaborationCommissionBalance, collaborationCommissionEarnings, withdrawalMinimum, paidWithdrawals, reservedWithdrawals, transactions, withdrawals, collaborationCommissions] = await Promise.all([
    prisma.report.groupBy({ by: ['status'], where: { agentId }, _count: { _all: true } }),
    prisma.transaction.aggregate({ where: { agentId }, _sum: { amount: true } }),
    getAvailableCollaborationCommissionAmount(prisma, agentId),
    getTotalCollaborationCommissionAmount(prisma, agentId),
    getWithdrawalMinimum(prisma),
    prisma.withdrawal.aggregate({ where: { agentId, status: 'PAYE' }, _sum: { amount: true } }),
    prisma.withdrawal.aggregate({ where: { agentId, status: { in: ['DEMANDE', 'APPROUVE'] } }, _sum: { amount: true } }),
    prisma.transaction.findMany({ where: { agentId }, orderBy: { createdAt: 'desc' }, take: 20, include: { report: { select: { companyName: true } } } }),
    prisma.withdrawal.findMany({ where: { agentId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.collaborationCommission.findMany({
      where: { agentId, status: 'PENDING', currency: 'Ar' },
      orderBy: { generatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        amount: true,
        generatedAt: true,
        deal: { select: { saleNumber: true } },
        adjustments: { select: { amount: true } },
      },
    }),
  ]);
  const reportCounts = Object.fromEntries(reports.map(({ status, _count }) => [status, _count._all]));
  const validatedReports = reportCounts.VALIDE ?? 0;
  const rejectedReports = reportCounts.REJETE ?? 0;
  const transactionEarnings = gains._sum.amount ?? 0n;
  const totalGains = walletNumber(transactionEarnings + collaborationCommissionEarnings, 'Agent wallet earnings');
  const walletCredits = transactionEarnings + collaborationCommissionBalance;
  const totalWithdrawnAmount = paidWithdrawals._sum.amount ?? 0n;
  const reservedWithdrawalAmount = reservedWithdrawals._sum.amount ?? 0n;
  const totalWithdrawn = walletNumber(totalWithdrawnAmount, 'Agent total withdrawals');
  const amountReserved = walletNumber(reservedWithdrawalAmount, 'Agent reserved withdrawals');
  const availableBalance = walletNumber(
    walletCredits - totalWithdrawnAmount - reservedWithdrawalAmount > 0n
      ? walletCredits - totalWithdrawnAmount - reservedWithdrawalAmount
      : 0n,
    'Agent available wallet balance',
  );
  const reviewedReports = validatedReports + rejectedReports;
  response.json({ data: {
    reportCounts,
    pendingReports: (reportCounts.SOUMIS ?? 0) + (reportCounts.EN_VERIFICATION ?? 0) + (reportCounts.A_COMPLETER ?? 0),
    validationRate: reviewedReports ? Math.round((validatedReports / reviewedReports) * 100) : 0,
    totalGains,
    totalWithdrawn,
    pendingWithdrawals: amountReserved,
    availableBalance,
    withdrawalMinimum,
    transactions: [
      ...transactions.map((item) => ({ id: item.id, type: item.type, amount: Number(item.amount), note: item.note, reportName: item.report?.companyName ?? null, createdAt: item.createdAt })),
      ...collaborationCommissions.map((item) => ({
        id: -item.id,
        type: 'GAIN_COLLABORATION',
        amount: Number(item.amount + item.adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0n)),
        note: `Commission de collaboration · vente ${item.deal.saleNumber ?? item.id}`,
        reportName: null,
        createdAt: item.generatedAt,
      })),
    ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, 20),
    withdrawals: withdrawals.map((item) => ({ id: item.id, amount: Number(item.amount), status: item.status, operator: item.operator, phoneNumber: item.phoneNumber, createdAt: item.createdAt, paymentReference: item.paymentReference })),
  } });
}

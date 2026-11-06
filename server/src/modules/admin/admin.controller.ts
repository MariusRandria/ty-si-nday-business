import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { isEmailDeliveryConfigured, sendAgentApprovalEmail, sendWithdrawalStatusEmail } from '../../lib/email.js';
import { prisma } from '../../lib/prisma.js';
import { decryptReportPii } from '../collaboration/report-pii.js';
import { writeCollaborationAudit } from '../collaboration/collaboration.audit.js';
import type { AuthRequest } from '../auth/auth.middleware.js';
import { notifyUser } from '../notifications/notifications.service.js';

const ACTIVATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

async function createActivationToken(transaction: Prisma.TransactionClient, userId: number, tokenHash: string) {
  const now = new Date();
  await transaction.activationToken.updateMany({
    where: { userId, type: 'ACTIVATION', usedAt: null },
    data: { usedAt: now },
  });
  await transaction.activationToken.create({
    data: {
      userId,
      tokenHash,
      type: 'ACTIVATION',
      expiresAt: new Date(now.getTime() + ACTIVATION_TOKEN_TTL_MS),
    },
  });
}

function getActivationUrl(email: string, token: string) {
  const url = new URL('/', env.agentAppUrl);
  url.searchParams.set('activationEmail', email);
  url.searchParams.set('activationToken', token);
  return url.toString();
}

const COMMISSION_CONFIG = {
  LEAD: { key: 'report_lead_amount', fallback: 50000, label: 'apport de contact' },
  PROVIDED_CONTACT: { key: 'report_sale_amount', fallback: 100000, label: 'vente d’un contact fourni' },
  FULL_CYCLE: { label: 'prospection et vente' },
} as const;

export async function getAdminDashboard(_request: Request, response: Response) {
  const [applications, reports, withdrawals, agents, paid, recentReports, recentApplications, recentWithdrawals] = await Promise.all([
    prisma.application.count({ where: { status: { in: ['RECUE', 'EN_EXAMEN'] } } }),
    prisma.report.count({ where: { status: { in: ['BROUILLON', 'SOUMIS', 'EN_VERIFICATION', 'A_COMPLETER'] } } }),
    prisma.withdrawal.count({ where: { status: { in: ['DEMANDE', 'APPROUVE'] } } }),
    prisma.user.count({ where: { role: 'AGENT', status: 'ACTIF' } }),
    prisma.withdrawal.aggregate({ where: { status: 'PAYE' }, _sum: { amount: true } }),
    prisma.report.findMany({ take: 8, orderBy: { createdAt: 'desc' }, select: { id: true, companyName: true, status: true, createdAt: true, agent: { select: { email: true, agentProfile: { select: { firstName: true, lastName: true } } } } } }),
    prisma.application.findMany({ take: 8, orderBy: { createdAt: 'desc' }, select: { id: true, fullName: true, status: true, createdAt: true } }),
    prisma.withdrawal.findMany({ take: 8, orderBy: { createdAt: 'desc' }, select: { id: true, amount: true, status: true, createdAt: true, agent: { select: { email: true, agentProfile: { select: { firstName: true, lastName: true } } } } } }),
  ]);
  const recentActivity = [
    ...recentReports.map((item) => ({ id: `report-${item.id}`, kind: 'Rapport', title: item.companyName, detail: item.agent.agentProfile ? `${item.agent.agentProfile.firstName} ${item.agent.agentProfile.lastName}` : item.agent.email, status: item.status, createdAt: item.createdAt, view: 'admin-reports' })),
    ...recentApplications.map((item) => ({ id: `application-${item.id}`, kind: 'Candidature', title: item.fullName, detail: 'Nouvelle candidature', status: item.status, createdAt: item.createdAt, view: 'admin-applications' })),
    ...recentWithdrawals.map((item) => ({ id: `withdrawal-${item.id}`, kind: 'Retrait', title: `${Number(item.amount).toLocaleString('fr-FR')} Ar`, detail: item.agent.agentProfile ? `${item.agent.agentProfile.firstName} ${item.agent.agentProfile.lastName}` : item.agent.email, status: item.status, createdAt: item.createdAt, view: 'admin-withdrawals' })),
  ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, 8);
  response.json({ data: { pendingApplications: applications, pendingReports: reports, pendingWithdrawals: withdrawals, activeAgents: agents, totalPaid: Number(paid._sum.amount ?? 0), recentActivity } });
}

export async function listApplications(_request: Request, response: Response) {
  const applications = await prisma.application.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      reviewer: { select: { email: true } },
      user: { select: { id: true, status: true } },
    },
  });
  response.json({
    data: applications.map(({ candidatePasswordHash: _candidatePasswordHash, user, ...application }) => ({
      ...application,
      userId: user?.id ?? null,
      userStatus: user?.status ?? null,
    })),
  });
}

export async function updateAgentStatus(request: AuthRequest, response: Response) {
  const id = Number(request.params.id);
  const body = request.body as { status?: unknown; reason?: unknown };
  const status = body?.status;
  const nextStatus = status === 'ACTIF' ? 'ACTIF' : 'SUSPENDU';
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!Number.isInteger(id) || id < 1 || !status || !['ACTIF', 'SUSPENDU'].includes(String(status))
    || reason.length < 10 || reason.length > 2000) {
    response.status(400).json({ error: 'Identifiant ou statut d’agent invalide' });
    return;
  }
  const outcome = await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({ where: { id }, select: { id: true, role: true, status: true } });
    if (!user || user.role !== 'AGENT') return null;
    if (user.status === nextStatus) return { unchanged: true as const }
    const updated = await transaction.user.update({
      where: { id },
      data: { status: nextStatus },
      select: { id: true, status: true, email: true },
    });
    await writeCollaborationAudit(transaction, {
      actorId: request.user?.id,
      actorRole: request.user?.role,
      action: nextStatus === 'SUSPENDU' ? 'AGENT_SUSPENDED_BY_ADMIN' : 'AGENT_REACTIVATED_BY_ADMIN',
      entityType: 'User',
      entityId: id,
      oldValues: { status: user.status },
      newValues: { status: nextStatus },
      metadata: reason ? { reason } : undefined,
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
    });
    return { unchanged: false as const, updated }
  });
  if (!outcome) {
    response.status(404).json({ error: 'Compte agent introuvable' });
    return;
  }
  if (outcome.unchanged) {
    response.status(409).json({ error: 'Le compte possède déjà ce statut.' });
    return;
  }
  const updated = outcome.updated;
  response.json({
    data: updated,
    message: nextStatus === 'SUSPENDU' ? 'Compte agent suspendu. Il ne peut plus se connecter tant qu’il n’est pas réactivé.' : 'Compte agent réactivé. Il peut de nouveau se connecter.',
  });
}

export async function updateApplication(request: AuthRequest, response: Response) {
  const id = Number(request.params.id);
  const { status, decisionReason } = request.body as { status?: 'EN_EXAMEN' | 'ACCEPTEE' | 'REFUSEE'; decisionReason?: string };
  if (!Number.isInteger(id) || id < 1 || !status || !['EN_EXAMEN', 'ACCEPTEE', 'REFUSEE'].includes(status) || (status === 'REFUSEE' && !decisionReason?.trim())) { response.status(400).json({ error: 'Statut, motif ou identifiant invalide' }); return; }
  const existing = await prisma.application.findUnique({ where: { id } });
  if (!existing) { response.status(404).json({ error: 'Candidature introuvable' }); return; }
  if (status === 'ACCEPTEE') {
    if (!isEmailDeliveryConfigured()) {
      response.status(503).json({ error: 'Impossible d’accepter la candidature : l’envoi des emails n’est pas configuré.' });
      return;
    }
    const email = existing.email.trim().toLowerCase();
    const rawActivationToken = randomBytes(32).toString('hex');
    const activationTokenHash = await bcrypt.hash(rawActivationToken, 12);
    const initialPasswordHash = await bcrypt.hash(randomUUID(), 12);
    try {
      const { application, activationRequired } = await prisma.$transaction(async (transaction) => {
        let userId = existing.userId;
        let activationRequired = true;
        let roleAssigned = false;
        if (userId) {
          const linkedUser = await transaction.user.findUnique({ where: { id: userId }, select: { id: true, status: true } });
          if (!linkedUser) throw new Error('Le compte associé à cette candidature est introuvable.');
          if (linkedUser.status === 'ACTIF') {
            activationRequired = false;
          } else {
            await transaction.user.update({
              where: { id: userId },
              data: { passwordHash: initialPasswordHash, status: 'EN_ATTENTE_ACTIVATION' },
            });
            await createActivationToken(transaction, userId, activationTokenHash);
          }
        } else {
          const [firstName, ...lastNameParts] = existing.fullName.trim().split(/\s+/);
          const lastName = lastNameParts.join(' ') || firstName;
          const user = await transaction.user.create({
            data: {
              email,
              passwordHash: initialPasswordHash,
              role: 'AGENT',
              status: 'EN_ATTENTE_ACTIVATION',
              agentProfile: {
                create: {
                  firstName,
                  lastName,
                  phone: existing.phone,
                  city: existing.city,
                  cguAcceptedAt: existing.consent ? existing.createdAt : null,
                },
              },
            },
          });
          userId = user.id;
          roleAssigned = true;
          await createActivationToken(transaction, userId, activationTokenHash);
        }
        const application = await transaction.application.update({
          where: { id },
          data: { status, decisionReason: decisionReason ?? null, userId, candidatePasswordHash: null, reviewedBy: request.user?.id },
          select: { id: true, status: true, userId: true, decisionReason: true, reviewedBy: true, createdAt: true, updatedAt: true },
        });
        if (roleAssigned && userId) {
          await writeCollaborationAudit(transaction, {
            actorId: request.user?.id,
            actorRole: request.user?.role,
            action: 'USER_ROLE_ASSIGNED',
            entityType: 'User',
            entityId: userId,
            oldValues: { role: null },
            newValues: { role: 'AGENT' },
            metadata: { applicationId: id },
            ip: request.ip ?? null,
            userAgent: request.get('user-agent') ?? null,
          });
        }
        return { application, activationRequired };
      });
      if (application.userId) {
        await notifyUser(application.userId, {
          type: 'APPLICATION_APPROVED',
          title: 'Votre candidature agent est acceptée',
          body: activationRequired
            ? 'Activez votre compte depuis le lien reçu par email pour créer votre mot de passe.'
            : 'Votre candidature est acceptée. Vous pouvez accéder à votre espace agent.',
          link: '/profile',
          actorId: request.user!.id,
        });
      }
      try {
        await sendAgentApprovalEmail(
          email,
          existing.fullName,
          activationRequired ? getActivationUrl(email, rawActivationToken) : undefined,
        );
      } catch (error) {
        console.error('Unable to send agent application approval email:', error);
        response.status(502).json({
          error: 'Candidature acceptée, mais l’email de confirmation n’a pas pu être envoyé. Utilisez « Renvoyer l’email » pour réessayer.',
          data: application,
        });
        return;
      }
      response.json({
        data: {
          ...application,
          userStatus: activationRequired ? 'EN_ATTENTE_ACTIVATION' : 'ACTIF',
        },
        message: activationRequired
          ? 'Candidature acceptée. Un email de confirmation avec le lien de création du mot de passe a été envoyé.'
          : 'Candidature acceptée. Un email de confirmation a été envoyé.',
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      response.status(409).json({ error: 'Un compte agent existe déjà avec cet email ou ce téléphone.' });
    }
    return;
  }
  const application = await prisma.application.update({
    where: { id },
    data: { status, decisionReason: decisionReason ?? null, candidatePasswordHash: status === 'REFUSEE' ? null : existing.candidatePasswordHash, reviewedBy: request.user?.id },
    select: { id: true, status: true, userId: true, decisionReason: true, reviewedBy: true, createdAt: true, updatedAt: true },
  });
  response.json({ data: application });
}

export async function resendApplicationApprovalEmail(request: AuthRequest, response: Response) {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id < 1) {
    response.status(400).json({ error: 'Identifiant de candidature invalide.' });
    return;
  }
  if (!isEmailDeliveryConfigured()) {
    response.status(503).json({ error: 'L’envoi des emails n’est pas configuré.' });
    return;
  }

  const application = await prisma.application.findUnique({
    where: { id },
    include: { user: { select: { id: true, status: true } } },
  });
  if (!application || application.status !== 'ACCEPTEE' || !application.user) {
    response.status(409).json({ error: 'Cette candidature acceptée ne possède pas de compte agent à notifier.' });
    return;
  }

  let activationUrl: string | undefined;
  if (application.user.status === 'EN_ATTENTE_ACTIVATION') {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(rawToken, 12);
    await prisma.$transaction(async (transaction) => createActivationToken(transaction, application.user!.id, tokenHash));
    activationUrl = getActivationUrl(application.email.trim().toLowerCase(), rawToken);
  } else if (application.user.status !== 'ACTIF') {
    response.status(409).json({ error: 'Le compte agent est suspendu. Réactivez-le avant de renvoyer l’email.' });
    return;
  }

  try {
    await sendAgentApprovalEmail(application.email, application.fullName, activationUrl);
  } catch (error) {
    console.error('Unable to resend agent application approval email:', error);
    response.status(502).json({ error: 'L’email de confirmation n’a pas pu être envoyé. Vérifiez la configuration SMTP.' });
    return;
  }

  response.json({ message: 'Email de confirmation renvoyé.' });
}

export async function listReports(_request: Request, response: Response) {
  const reports = await prisma.report.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      agent: { include: { agentProfile: true } },
      product: { select: { title: true } },
      gainTransaction: { select: { amount: true } },
      statusHistory: {
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { email: true, agentProfile: { select: { firstName: true, lastName: true } } } } },
      },
    },
  });
  response.json({
    data: reports.map(({ gainTransaction, ...report }) => ({
      ...decryptReportPii(report),
      commissionAmount: report.commissionAmount !== null
        ? Number(report.commissionAmount)
        : gainTransaction ? Number(gainTransaction.amount) : undefined,
    })),
  });
}

export async function updateReport(request: AuthRequest, response: Response) {
  const id = Number(request.params.id);
  const { status, rejectionReason, contractSigned } = request.body as { status?: 'VALIDE' | 'REJETE' | 'A_COMPLETER' | 'PAYE'; rejectionReason?: string; contractSigned?: boolean };
  if (!Number.isInteger(id) || id < 1 || !status || !['VALIDE', 'REJETE', 'A_COMPLETER', 'PAYE'].includes(status) || (status === 'REJETE' && !rejectionReason?.trim())) {
    response.status(400).json({ error: 'Statut ou motif invalide' });
    return;
  }
  if (contractSigned !== undefined && typeof contractSigned !== 'boolean') {
    response.status(400).json({ error: 'La confirmation de signature est invalide.' });
    return;
  }

  const currentReport = await prisma.report.findUnique({ where: { id } });
  if (!currentReport) { response.status(404).json({ error: 'Rapport introuvable' }); return; }

  if (status === 'VALIDE' && contractSigned !== true && !currentReport.contractSigned) {
    response.status(400).json({ error: 'Confirmez la signature du contrat avant de valider ce rapport.' });
    return;
  }

  if (status === 'VALIDE' && !['BROUILLON', 'SOUMIS', 'EN_VERIFICATION', 'A_COMPLETER'].includes(currentReport.status)) {
    response.status(409).json({ error: 'Seul un rapport en attente peut être validé.' });
    return;
  }

  if (status === 'PAYE' && currentReport.status !== 'VALIDE') {
    response.status(409).json({ error: 'Seul un rapport validé peut être payé.' });
    return;
  }

  if (status === 'REJETE' && !['BROUILLON', 'SOUMIS', 'EN_VERIFICATION', 'A_COMPLETER'].includes(currentReport.status)) {
    response.status(409).json({ error: 'Seul un rapport en attente peut être rejeté.' });
    return;
  }

  if (status === 'A_COMPLETER' && !['BROUILLON', 'SOUMIS', 'EN_VERIFICATION', 'A_COMPLETER'].includes(currentReport.status)) {
    response.status(409).json({ error: 'Seul un rapport en attente peut être retourné pour complément.' });
    return;
  }

  if (status === 'VALIDE') {
    const duplicate = await prisma.report.findFirst({
      where: {
        agentId: currentReport.agentId,
        ...(currentReport.productId !== null
          ? { productId: currentReport.productId }
          : { productId: null, customServiceDescription: currentReport.customServiceDescription }),
        companyNameNormalized: currentReport.companyNameNormalized,
        id: { not: id },
        status: { in: ['BROUILLON', 'SOUMIS', 'EN_VERIFICATION', 'VALIDE', 'PAYE', 'A_COMPLETER'] },
      },
    });
    if (duplicate) {
      response.status(409).json({ error: 'Ce client est déjà associé à un rapport validé ou actif sur ce produit. Un second paiement est bloqué.' });
      return;
    }

  }

  const beforeStatus = currentReport.status;
  let commissionAmount = currentReport.commissionAmount === null ? null : Number(currentReport.commissionAmount);
  if (status === 'VALIDE' || (status === 'PAYE' && commissionAmount === null)) {
    const settings = await prisma.setting.findMany({
      where: { key: { in: ['report_lead_amount', 'report_sale_amount'] } },
      select: { key: true, value: true },
    });
    const configuredAmounts = Object.fromEntries(settings.map(({ key, value }) => [key, Number(value)]));
    const leadAmount = configuredAmounts.report_lead_amount ?? COMMISSION_CONFIG.LEAD.fallback;
    const saleAmount = configuredAmounts.report_sale_amount ?? COMMISSION_CONFIG.PROVIDED_CONTACT.fallback;
    if (![leadAmount, saleAmount].every((amount) => Number.isSafeInteger(amount) && amount >= 0)) {
      response.status(500).json({ error: 'Un montant de commission configuré est invalide.' });
      return;
    }
    commissionAmount = currentReport.reportType === 'LEAD'
      ? leadAmount
      : currentReport.reportType === 'PROVIDED_CONTACT'
        ? saleAmount
        : leadAmount + saleAmount;
    if (!Number.isSafeInteger(commissionAmount)) {
      response.status(500).json({ error: 'Le montant de commission calculé dépasse la limite autorisée.' });
      return;
    }
  }

  let report;
  try {
    report = await prisma.$transaction(async (transaction) => {
      const updatedReport = await transaction.report.update({
        where: { id },
        data: {
          status,
          rejectionReason: status === 'REJETE' ? rejectionReason!.trim() : null,
          reviewedAt: status === 'VALIDE' || status === 'REJETE' ? new Date() : currentReport.reviewedAt,
          contractSigned: status === 'VALIDE' ? true : currentReport.contractSigned,
          commissionAmount: status === 'VALIDE' && commissionAmount !== null ? BigInt(commissionAmount) : currentReport.commissionAmount,
        },
      });

      if (status === 'PAYE') {
        if (commissionAmount === null) throw new Error('Montant de commission manquant lors du paiement du rapport.');
        await transaction.transaction.create({
          data: {
            agentId: currentReport.agentId,
            type: 'GAIN_RAPPORT',
            amount: BigInt(commissionAmount),
            reportId: currentReport.id,
            note: `Commission ${COMMISSION_CONFIG[currentReport.reportType].label} : ${commissionAmount.toLocaleString('fr-FR')} Ar.`,
          },
        });
      }

      await transaction.reportStatusHistory.create({
        data: {
          reportId: updatedReport.id,
          fromStatus: beforeStatus,
          toStatus: updatedReport.status,
          changedBy: request.user?.id ?? updatedReport.agentId,
          comment: status === 'VALIDE'
            ? `Rapport validé après confirmation de la signature. Commission à verser : ${commissionAmount?.toLocaleString('fr-FR')} Ar.`
            : status === 'PAYE'
              ? `Commission versée sur le portefeuille : ${commissionAmount?.toLocaleString('fr-FR')} Ar.`
              : status === 'REJETE'
              ? 'Commission refusée.'
              : status === 'A_COMPLETER'
                ? 'Commission bloquée : informations incomplètes.'
                : 'Statut du rapport mis à jour.',
        },
      });

      return updatedReport;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      response.status(409).json({ error: 'La commission de ce rapport a déjà été accordée.' });
      return;
    }
    throw error;
  }

  const statusLabel = status === 'VALIDE' ? 'validé, en attente de versement' : status === 'PAYE' ? 'payé et crédité sur votre portefeuille' : status === 'REJETE' ? 'rejeté' : 'à compléter';
  await notifyUser(report.agentId, { type: 'REPORT_REVIEWED', title: 'Mise à jour de votre rapport', body: `Le rapport « ${report.companyName} » est ${statusLabel}.`, link: '/reports', actorId: request.user!.id });
  response.json({ data: { ...decryptReportPii(report), commissionAmount: report.commissionAmount === null ? undefined : Number(report.commissionAmount) } });
}

export async function listWithdrawals(_request: Request, response: Response) {
  const withdrawals = await prisma.withdrawal.findMany({ orderBy: { createdAt: 'desc' }, include: { agent: { include: { agentProfile: true } } } });
  response.json({ data: withdrawals.map((withdrawal) => ({ ...withdrawal, amount: withdrawal.amount.toString() })) });
}

export async function updateWithdrawal(request: AuthRequest, response: Response) {
  const id = Number(request.params.id);
  const body = request.body as { status?: unknown; paymentReference?: unknown; rejectReason?: unknown };
  const status = body?.status;
  const paymentReference = typeof body?.paymentReference === 'string' ? body.paymentReference.trim() : '';
  const rejectReason = typeof body?.rejectReason === 'string' ? body.rejectReason.trim() : '';
  if (!Number.isSafeInteger(id) || id < 1 || (status !== 'APPROUVE' && status !== 'PAYE' && status !== 'REFUSE')
    || (status === 'PAYE' && (paymentReference.length < 5 || paymentReference.length > 100))
    || (status === 'REFUSE' && (rejectReason.length < 5 || rejectReason.length > 2000))
    || (status !== 'PAYE' && paymentReference)
    || (status !== 'REFUSE' && rejectReason)) {
    response.status(400).json({ error: 'Action, référence ou motif de retrait invalide.' });
    return;
  }
  if ((status === 'APPROUVE' || status === 'PAYE') && !isEmailDeliveryConfigured()) {
    response.status(503).json({ error: 'Le retrait n’a pas été modifié : la configuration email est indisponible.' });
    return;
  }
  const expectedStatuses: Array<'DEMANDE' | 'APPROUVE'> = status === 'APPROUVE' ? ['DEMANDE'] : ['DEMANDE', 'APPROUVE'];
  const withdrawal = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.withdrawal.updateMany({
      where: { id, status: { in: expectedStatuses } },
      data: {
        status,
        paymentReference: status === 'PAYE' ? paymentReference : null,
        rejectReason: status === 'REFUSE' ? rejectReason : null,
        decidedBy: request.user!.id,
        decidedAt: new Date(),
      },
    });
    if (updated.count !== 1) return null;
    return transaction.withdrawal.findUnique({
      where: { id },
      include: { agent: { select: { email: true, agentProfile: { select: { firstName: true, lastName: true } } } } },
    });
  });
  if (!withdrawal) {
    response.status(409).json({ error: 'Cette demande a déjà été traitée ou son statut a changé. Rechargez la liste.' });
    return;
  }
  const agentName = withdrawal.agent.agentProfile
    ? `${withdrawal.agent.agentProfile.firstName} ${withdrawal.agent.agentProfile.lastName}`
    : withdrawal.agent.email;
  let emailWarning: string | undefined;
  if (status === 'APPROUVE' || status === 'PAYE') {
    try {
      await sendWithdrawalStatusEmail(withdrawal.agent.email, {
        agentName,
        amount: withdrawal.amount,
        operator: withdrawal.operator,
        phoneNumber: withdrawal.phoneNumber,
        status,
        paymentReference: withdrawal.paymentReference,
      });
    } catch (error) {
      console.error(`Withdrawal ${status.toLowerCase()} email could not be sent:`, error);
      emailWarning = 'Le statut du retrait a été enregistré, mais l’email de confirmation n’a pas pu être envoyé.';
    }
  }
  const notificationBody = status === 'APPROUVE'
    ? 'Votre retrait est approuvé et son paiement est en cours de traitement.'
    : status === 'PAYE'
      ? emailWarning
        ? 'Votre retrait a été payé. La confirmation email est momentanément indisponible.'
        : 'Votre retrait a été payé. La confirmation a été envoyée par email.'
      : 'Votre demande de retrait a été refusée.';
  await notifyUser(withdrawal.agentId, { type: 'WITHDRAWAL_DECIDED', title: 'Mise à jour de votre retrait', body: notificationBody, link: '/wallet', actorId: request.user!.id });
  response.json({
    data: { ...withdrawal, amount: withdrawal.amount.toString() },
    ...(emailWarning ? { warning: emailWarning } : {}),
  });
}

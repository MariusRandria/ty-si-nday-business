import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../auth/auth.middleware.js';
import {
  decryptReportPii,
  encryptPii,
  hashNormalizedCompanyName,
  hashNormalizedEmail,
  hashNormalizedPhone,
  normalizeCompanyNameForHash,
} from '../collaboration/report-pii.js';
import { writeCollaborationAudit } from '../collaboration/collaboration.audit.js';
import { notifyAdmins } from '../notifications/notifications.service.js';
import { reportSchema, type ReportStatus } from './report.schema.js';

export async function listReports(request: AuthRequest, response: Response) {
  const requestedAgentId = request.query.agentId ? Number(request.query.agentId) : undefined;
  if (requestedAgentId !== undefined && (!Number.isInteger(requestedAgentId) || requestedAgentId < 1)) {
    response.status(400).json({ error: 'Identifiant agent invalide' });
    return;
  }
  const agentId = request.user?.role === 'AGENT' ? request.user.id : requestedAgentId;
  const status = typeof request.query.status === 'string' ? request.query.status : undefined;
  const validStatuses: ReportStatus[] = ['BROUILLON', 'SOUMIS', 'EN_VERIFICATION', 'VALIDE', 'REJETE', 'A_COMPLETER', 'PAYE'];
  if (status !== undefined && !validStatuses.includes(status as ReportStatus)) {
    response.status(400).json({ error: 'Statut de rapport invalide' });
    return;
  }
  try {
    const [reports, settings] = await Promise.all([prisma.report.findMany({
      where: {
        ...(agentId !== undefined ? { agentId } : {}),
        ...(status !== undefined ? { status: status as ReportStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { title: true } },
        gainTransaction: { select: { amount: true } },
        statusHistory: {
          orderBy: { createdAt: 'desc' },
          include: { actor: { select: { email: true, agentProfile: { select: { firstName: true, lastName: true } } } } },
        },
      },
    }), prisma.setting.findMany({
      where: { key: { in: ['report_lead_amount', 'report_sale_amount'] } },
      select: { key: true, value: true },
    })]);
    const configuredAmounts = Object.fromEntries(settings.map(({ key, value }) => [key, Number(value)]));
    const leadAmount = configuredAmounts.report_lead_amount ?? 50000;
    const saleAmount = configuredAmounts.report_sale_amount ?? 100000;
    if (![leadAmount, saleAmount].every((amount) => Number.isSafeInteger(amount) && amount >= 0)
      || !Number.isSafeInteger(leadAmount + saleAmount)) {
      response.status(500).json({ error: 'Un montant de commission configuré est invalide.' });
      return;
    }
    response.json({ data: reports.map(({ gainTransaction, ...report }) => ({
      ...decryptReportPii(report),
      commissionAmount: report.status === 'REJETE' ? null
        : report.commissionAmount !== null
          ? Number(report.commissionAmount)
          : gainTransaction ? Number(gainTransaction.amount)
            : report.reportType === 'LEAD' ? leadAmount
              : report.reportType === 'PROVIDED_CONTACT' ? saleAmount
                : leadAmount + saleAmount,
      commissionEstimated: report.status !== 'REJETE' && report.commissionAmount === null && !gainTransaction,
    })) });
  } catch (error) {
    console.error('Failed to list reports:', error);
    response.status(500).json({ error: 'Impossible de charger les rapports' });
  }
}

export async function createReport(request: AuthRequest, response: Response) {
  if (!request.user || request.user.role !== 'AGENT') {
    response.status(403).json({ error: 'Seuls les agents peuvent créer un rapport' });
    return;
  }
  const result = reportSchema.safeParse(request.body);
  if (!result.success) {
    response.status(400).json({ error: 'Données de rapport invalides', details: result.error.flatten() });
    return;
  }

  const data = result.data;
  if (data.productId !== null) {
    const product = await prisma.product.findFirst({ where: { id: data.productId, status: 'PUBLIE' }, select: { id: true } });
    if (!product) {
      response.status(400).json({ error: 'Le produit sélectionné est introuvable ou n’est plus publié.' });
      return;
    }
  }

  const normalizedCompanyName = normalizeCompanyNameForHash(data.companyName);
  const existingReport = await prisma.report.findFirst({
    where: {
      agentId: request.user.id,
      ...(data.productId !== null
        ? { productId: data.productId }
        : { productId: null, customServiceDescription: data.customServiceDescription }),
      companyNameNormalized: normalizedCompanyName,
      status: { in: ['BROUILLON', 'SOUMIS', 'EN_VERIFICATION', 'VALIDE', 'PAYE', 'A_COMPLETER'] },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existingReport) {
    response.status(409).json({ error: 'Un rapport actif ou validé existe déjà pour ce client sur ce produit. Un second paiement est bloqué.' });
    return;
  }

  const promoCode = data.reportType === 'LEAD' ? null : `TSN-${String(request.user.id).padStart(6, '0')}`;
  const phoneHash = hashNormalizedPhone(data.contactPhone);
  const emailHash = data.contactEmail ? hashNormalizedEmail(data.contactEmail) : null;
  try {
    const outcome = await prisma.$transaction(async (transaction) => {
      if (data.reportType === 'LEAD') {
        await transaction.$queryRaw`SELECT id FROM collaboration_audit_heads WHERE id = 1 FOR UPDATE`;
        const duplicate = await transaction.collaborationProspectHashClaim.findFirst({
          where: {
            OR: [
              { contactType: 'PHONE', contactHash: phoneHash },
              ...(emailHash ? [{ contactType: 'EMAIL', contactHash: emailHash }] : []),
            ],
          },
          orderBy: [{ claimedAt: 'asc' }, { id: 'asc' }],
          include: {
            deal: {
              select: {
                id: true,
                declaredAt: true,
                supplier: { select: { email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
              },
            },
          },
        });
        if (duplicate) {
          const firstDeclarer = duplicate.deal.supplier.agentProfile
            ? `${duplicate.deal.supplier.agentProfile.firstName} ${duplicate.deal.supplier.agentProfile.lastName}`.trim()
            : duplicate.deal.supplier.email;
          await writeCollaborationAudit(transaction, {
            actorId: request.user!.id,
            actorRole: request.user!.role,
            action: 'COLLABORATION_DUPLICATE_DECLARATION_BLOCKED',
            entityType: 'CollaborationDeal',
            entityId: duplicate.deal.id,
            metadata: { contactType: duplicate.contactType },
            ip: request.ip ?? null,
            userAgent: request.get('user-agent') ?? null,
          });
          return {
            duplicate: {
              firstDeclarer,
              firstDeclaredAt: duplicate.deal.declaredAt,
            },
            report: null,
          };
        }
      }
      const createdReport = await transaction.report.create({
        data: {
          ...data,
          agentId: request.user!.id,
          companyNameNormalized: normalizedCompanyName,
          address: encryptPii(data.address),
          contactPhone: encryptPii(data.contactPhone),
          contactPhoneHash: phoneHash,
          contactEmail: data.contactEmail ? encryptPii(data.contactEmail) : null,
          contactEmailHash: emailHash,
          customServiceDescription: data.productId === null ? data.customServiceDescription : null,
          status: 'SOUMIS',
          reportNature: data.reportNature,
          promoCode,
        },
      });
      await transaction.reportStatusHistory.create({
        data: {
          reportId: createdReport.id,
          toStatus: 'SOUMIS',
          changedBy: request.user!.id,
          comment: 'Rapport soumis par l’agent.',
        },
      });

      if (data.reportType === 'LEAD') {
        const deal = await transaction.collaborationDeal.create({
          data: {
            reportId: createdReport.id,
            supplierId: request.user!.id,
            secret: {
              create: {
                companyNameCiphertext: encryptPii(data.companyName),
                contactNameCiphertext: encryptPii(data.contactName),
                phoneCiphertext: encryptPii(data.contactPhone),
                emailCiphertext: data.contactEmail ? encryptPii(data.contactEmail) : null,
                addressCiphertext: encryptPii(data.address),
                companyNameHash: hashNormalizedCompanyName(data.companyName),
                phoneHash,
                emailHash,
              },
            },
          },
        });
        await transaction.collaborationProspectHashClaim.createMany({
          data: [
            { contactType: 'PHONE', contactHash: phoneHash, dealId: deal.id, supplierId: request.user!.id },
            ...(emailHash ? [{ contactType: 'EMAIL', contactHash: emailHash, dealId: deal.id, supplierId: request.user!.id }] : []),
          ],
        });
        await writeCollaborationAudit(transaction, {
          actorId: request.user!.id,
          dealId: deal.id,
          action: 'COLLABORATION_DEAL_DECLARED',
          entityType: 'CollaborationDeal',
          entityId: deal.id,
          metadata: { reportId: createdReport.id },
          ip: request.ip ?? null,
          userAgent: request.get('user-agent') ?? null,
        });
      }
      await writeCollaborationAudit(transaction, {
        actorId: request.user!.id,
        action: 'REPORT_SUBMITTED',
        entityType: 'Report',
        entityId: createdReport.id,
        metadata: { reportType: data.reportType },
        ip: request.ip ?? null,
        userAgent: request.get('user-agent') ?? null,
      });

      return { duplicate: null, report: createdReport };
    });
    if (outcome.duplicate) {
      response.status(409).json({
        error: 'Ce prospect a déjà été déclaré.',
        firstDeclaredBy: outcome.duplicate.firstDeclarer,
        firstDeclaredAt: outcome.duplicate.firstDeclaredAt,
      });
      return;
    }
    const report = outcome.report!;
    await notifyAdmins({ type: 'REPORT_SUBMITTED', title: 'Nouveau rapport agent', body: `${report.companyName} a été ajouté au portefeuille de l’agent ${request.user.id}.`, link: '/admin-reports' });
    response.status(201).json({ data: decryptReportPii(report) });
  } catch (error) {
    console.error('Failed to create report:', error);
    response.status(500).json({ error: 'Enregistrement du rapport impossible. Vérifiez les données et la base de données.' });
  }
}

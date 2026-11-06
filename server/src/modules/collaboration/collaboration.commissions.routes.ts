import { Router } from 'express'
import type { Request, RequestHandler, Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { env } from '../../config/env.js'
import { prisma } from '../../lib/prisma.js'
import type { AuthRequest } from '../auth/auth.middleware.js'
import { requireAdminTotp } from './admin-totp.js'
import { writeCollaborationAudit } from './collaboration.audit.js'
import { collaborationRateLimit } from './collaboration.rate-limit.js'
import { createSignedEvidenceUrl } from './collaboration.files.js'
import { canResolveHeldCommission, disputeResolutionStatus, shouldCompleteCommissionsPaid } from './collaboration.commissions.policy.js'
import { findCommissionReconciliationIssues, holdPendingCommissionsForDeal } from './collaboration.commissions.service.js'
import { CollaborationAccessError, transitionCollaborationDeal } from './collaboration.policy.js'

const decisionSchema = z.object({
  action: z.enum(['RELEASE', 'CANCEL', 'REASSIGN']),
  reason: z.string().trim().min(10).max(2000),
  targetAgentId: z.number().int().positive().optional(),
}).strict()

const adjustmentSchema = z.object({
  amount: z.number().int().safe().refine((value) => value !== 0),
  reason: z.string().trim().min(10).max(2000),
  idempotencyKey: z.string().uuid(),
}).strict()

const disputeSchema = z.object({ reason: z.string().trim().min(10).max(2000) }).strict()

function asyncRoute(handler: (request: AuthRequest, response: Response) => Promise<void>): RequestHandler {
  return (request, response, next) => {
    void handler(request as AuthRequest, response).catch((error: unknown) => {
      if (error instanceof CollaborationAccessError) {
        response.status(error.statusCode).json({ error: error.message })
        return
      }
      next(error)
    })
  }
}

function parseId(value: string | string[]): number | null {
  if (typeof value !== 'string') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function requestAudit(request: Request) {
  return { ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null }
}

function parseDate(value: unknown): Date | null | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseDateRange(request: Request, response: Response) {
  const from = parseDate(request.query.from)
  const to = parseDate(request.query.to)
  if (from === null || to === null || (from && to && from > to)) {
    response.status(400).json({ error: 'Période invalide.' })
    return null
  }
  return { from, to }
}

function dateFilter(from?: Date, to?: Date): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
}

function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function commissionResponse(commission: {
  id: number
  dealId: number
  agentId: number
  role: string
  amount: bigint
  currency: string
  status: string
  paymentMode: string | null
  paymentReference: string | null
  generatedAt: Date
  paidAt: Date | null
  deal: { saleNumber: string | null }
}) {
  return {
    id: commission.id,
    dealId: commission.dealId,
    agentId: commission.agentId,
    role: commission.role,
    amount: commission.amount.toString(),
    currency: commission.currency,
    status: commission.status,
    paymentMode: commission.paymentMode,
    paymentReference: commission.paymentReference,
    generatedAt: commission.generatedAt,
    paidAt: commission.paidAt,
    saleNumber: commission.deal.saleNumber,
  }
}

export const collaborationCommissionsRouter = Router()
export const collaborationAdminCommissionsRouter = Router()

collaborationCommissionsRouter.get('/me', collaborationRateLimit({ scope: 'commission-agent-list', limit: 60, windowMs: 60_000 }), asyncRoute(async (request, response) => {
  if (!request.user || request.user.role !== 'AGENT') {
    response.status(403).json({ error: 'Cette vue est réservée à l’agent connecté.' })
    return
  }
  const range = parseDateRange(request, response)
  if (!range) return
  const where: Prisma.CollaborationCommissionWhereInput = {
    agentId: request.user.id,
    ...(request.query.status && ['PENDING', 'PAID', 'CANCELLED', 'ON_HOLD'].includes(String(request.query.status))
      ? { status: String(request.query.status) as 'PENDING' | 'PAID' | 'CANCELLED' | 'ON_HOLD' }
      : {}),
    generatedAt: dateFilter(range.from, range.to),
  }
  if (request.query.status && !['PENDING', 'PAID', 'CANCELLED', 'ON_HOLD'].includes(String(request.query.status))) {
    response.status(400).json({ error: 'Statut de commission invalide.' })
    return
  }
  const commissions = await prisma.collaborationCommission.findMany({
    where,
    orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
    take: 200,
    select: {
      id: true,
      dealId: true,
      agentId: true,
      role: true,
      amount: true,
      currency: true,
      status: true,
      paymentMode: true,
      paymentReference: true,
      generatedAt: true,
      paidAt: true,
      deal: { select: { saleNumber: true } },
      adjustments: { select: { id: true, amount: true, currency: true, reason: true, createdAt: true } },
    },
  })
  response.json({
    data: commissions.map(({ adjustments, ...commission }) => {
      const adjustmentTotal = adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0n)
      return {
        ...commissionResponse(commission),
        adjustmentTotal: adjustmentTotal.toString(),
        netAmount: (commission.amount + adjustmentTotal).toString(),
        adjustments: adjustments.map(({ amount, ...adjustment }) => ({ ...adjustment, amount: amount.toString() })),
      }
    }),
    limit: 200,
  })
}))

collaborationCommissionsRouter.get('/me/summary', collaborationRateLimit({ scope: 'commission-agent-summary', limit: 30, windowMs: 60_000 }), asyncRoute(async (request, response) => {
  if (!request.user || request.user.role !== 'AGENT') {
    response.status(403).json({ error: 'Cette vue est réservée à l’agent connecté.' })
    return
  }
  const range = parseDateRange(request, response)
  if (!range) return
  const commissions = await prisma.collaborationCommission.findMany({
    where: {
      agentId: request.user.id,
      generatedAt: dateFilter(range.from, range.to),
    },
    select: {
      amount: true,
      currency: true,
      status: true,
      generatedAt: true,
      adjustments: { select: { amount: true } },
    },
    orderBy: { generatedAt: 'asc' },
  })
  const totals = new Map<string, { pending: bigint; paid: bigint; onHold: bigint; cancelled: bigint }>()
  const periods = new Map<string, { currency: string; pending: bigint; paid: bigint; onHold: bigint; cancelled: bigint }>()
  for (const commission of commissions) {
    const netAmount = commission.amount + commission.adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0n)
    const total = totals.get(commission.currency) ?? { pending: 0n, paid: 0n, onHold: 0n, cancelled: 0n }
    if (commission.status === 'PENDING') total.pending += netAmount
    if (commission.status === 'PAID') total.paid += netAmount
    if (commission.status === 'ON_HOLD') total.onHold += netAmount
    if (commission.status === 'CANCELLED') total.cancelled += netAmount
    totals.set(commission.currency, total)
    const month = commission.generatedAt.toISOString().slice(0, 7)
    const periodKey = `${month}:${commission.currency}`
    const period = periods.get(periodKey) ?? { currency: commission.currency, pending: 0n, paid: 0n, onHold: 0n, cancelled: 0n }
    if (commission.status === 'PENDING') period.pending += netAmount
    if (commission.status === 'PAID') period.paid += netAmount
    if (commission.status === 'ON_HOLD') period.onHold += netAmount
    if (commission.status === 'CANCELLED') period.cancelled += netAmount
    periods.set(periodKey, period)
  }
  response.json({
    data: {
      periodBasis: 'generatedAt',
      totalsByCurrency: [...totals.entries()].map(([currency, values]) => ({
        currency,
        ...Object.fromEntries(Object.entries(values).map(([key, amount]) => [key, amount.toString()])),
      })),
      byPeriod: [...periods.entries()].map(([key, values]) => ({
        period: key.slice(0, 7),
        currency: values.currency,
        ...Object.fromEntries(Object.entries(values).filter(([field]) => field !== 'currency').map(([field, amount]) => [field, (amount as bigint).toString()])),
      })),
    },
  })
}))

const adminRateLimit = (scope: string, limit = 30) => collaborationRateLimit({ scope, limit, windowMs: 60_000 })

collaborationAdminCommissionsRouter.get('/commissions', adminRateLimit('admin-commission-list'), requireAdminTotp, asyncRoute(async (request, response) => {
  const range = parseDateRange(request, response)
  if (!range) return
  const allowedStatuses = ['PENDING', 'PAID', 'CANCELLED', 'ON_HOLD']
  if (request.query.status && !allowedStatuses.includes(String(request.query.status))) {
    response.status(400).json({ error: 'Statut de commission invalide.' })
    return
  }
  const agentId = request.query.agentId === undefined ? undefined : Number(request.query.agentId)
  if (agentId !== undefined && (!Number.isSafeInteger(agentId) || agentId < 1)) {
    response.status(400).json({ error: 'Identifiant d’agent invalide.' })
    return
  }
  const page = request.query.page === undefined ? 1 : Number(request.query.page)
  const limit = request.query.limit === undefined ? 50 : Number(request.query.limit)
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    response.status(400).json({ error: 'Pagination invalide.' })
    return
  }
  const where: Prisma.CollaborationCommissionWhereInput = {
    ...(request.query.status ? { status: String(request.query.status) as 'PENDING' | 'PAID' | 'CANCELLED' | 'ON_HOLD' } : {}),
    ...(agentId ? { agentId } : {}),
    generatedAt: dateFilter(range.from, range.to),
  }
  const [total, rows, aggregates] = await Promise.all([
    prisma.collaborationCommission.count({ where }),
    prisma.collaborationCommission.findMany({
      where,
      orderBy: [{ generatedAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        deal: { select: { saleNumber: true, contractSignedAt: true } },
        agent: { select: { id: true, email: true, status: true, agentProfile: { select: { firstName: true, lastName: true } } } },
        paymentEvidence: { select: { id: true, fileName: true, mimeType: true, fileSize: true, sha256: true, storageKey: true } },
        adjustments: { select: { amount: true } },
      },
    }),
    prisma.collaborationCommission.groupBy({
      by: ['status', 'currency'],
      where,
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ])
  response.json({
    data: rows.map(({ paymentEvidence, adjustments, deal, agent, ...commission }) => ({
      ...commissionResponse({ ...commission, deal }),
      adjustmentTotal: adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0n).toString(),
      netAmount: (commission.amount + adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0n)).toString(),
      agent: {
        id: agent.id,
        email: agent.email,
        status: agent.status,
        name: agent.agentProfile ? `${agent.agentProfile.firstName} ${agent.agentProfile.lastName}`.trim() : agent.email,
      },
      paymentEvidence: paymentEvidence ? {
        id: paymentEvidence.id,
        fileName: paymentEvidence.fileName,
        mimeType: paymentEvidence.mimeType,
        fileSize: paymentEvidence.fileSize,
        sha256: paymentEvidence.sha256,
        downloadUrl: createSignedEvidenceUrl(paymentEvidence.id, paymentEvidence.storageKey),
      } : null,
    })),
    pagination: { page, limit, total },
    totals: aggregates.map(({ status, currency, _count, _sum }) => ({
      status,
      currency,
      count: _count._all,
      amount: (_sum.amount ?? 0n).toString(),
    })),
  })
}))

collaborationAdminCommissionsRouter.get('/commissions/pending', adminRateLimit('admin-commission-pending'), requireAdminTotp, asyncRoute(async (_request, response) => {
  const rows = await prisma.collaborationCommission.findMany({
    where: { status: 'PENDING' },
    orderBy: [{ generatedAt: 'asc' }, { id: 'asc' }],
    take: 500,
    include: {
      deal: { select: { saleNumber: true } },
      agent: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
    },
  })
  response.json({
    data: rows.map(({ deal, agent, ...commission }) => ({
      ...commissionResponse({ ...commission, deal }),
      agent: {
        id: agent.id,
        email: agent.email,
        name: agent.agentProfile ? `${agent.agentProfile.firstName} ${agent.agentProfile.lastName}`.trim() : agent.email,
      },
    })),
    limit: 500,
  })
}))

collaborationAdminCommissionsRouter.get('/commissions/export.csv', adminRateLimit('admin-commission-export', 10), requireAdminTotp, asyncRoute(async (request, response) => {
  const range = parseDateRange(request, response)
  if (!range) return
  const allowedStatuses = ['PENDING', 'PAID', 'CANCELLED', 'ON_HOLD']
  if (request.query.status && !allowedStatuses.includes(String(request.query.status))) {
    response.status(400).json({ error: 'Statut de commission invalide.' })
    return
  }
  const agentId = request.query.agentId === undefined ? undefined : Number(request.query.agentId)
  if (agentId !== undefined && (!Number.isSafeInteger(agentId) || agentId < 1)) {
    response.status(400).json({ error: 'Identifiant d’agent invalide.' })
    return
  }
  const where: Prisma.CollaborationCommissionWhereInput = {
    ...(request.query.status ? { status: String(request.query.status) as 'PENDING' | 'PAID' | 'CANCELLED' | 'ON_HOLD' } : {}),
    ...(agentId === undefined ? {} : { agentId }),
    generatedAt: dateFilter(range.from, range.to),
  }
  const count = await prisma.collaborationCommission.count({ where })
  if (count > 10_000) {
    response.status(413).json({ error: 'Export trop volumineux. Réduisez la période ou filtrez par agent/statut.' })
    return
  }
  const rows = await prisma.collaborationCommission.findMany({
    where,
    orderBy: [{ generatedAt: 'asc' }, { id: 'asc' }],
    include: {
      deal: { select: { saleNumber: true } },
      agent: { select: { email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
      adjustments: { select: { amount: true } },
    },
  })
  const csv = [
    ['id', 'saleNumber', 'role', 'agent', 'amount', 'adjustmentTotal', 'netAmount', 'currency', 'status', 'paymentMode', 'paymentReference', 'generatedAt', 'paidAt'],
    ...rows.map((row) => [
      row.id,
      row.deal.saleNumber,
      row.role,
      row.agent.agentProfile ? `${row.agent.agentProfile.firstName} ${row.agent.agentProfile.lastName}`.trim() : row.agent.email,
      row.amount.toString(),
      row.adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0n).toString(),
      (row.amount + row.adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0n)).toString(),
      row.currency,
      row.status,
      row.paymentMode,
      row.paymentReference,
      row.generatedAt.toISOString(),
      row.paidAt?.toISOString() ?? '',
    ]),
  ].map((line) => line.map(csvCell).join(',')).join('\r\n')
  response.setHeader('Content-Type', 'text/csv; charset=utf-8')
  response.setHeader('Content-Disposition', 'attachment; filename="collaboration-commissions.csv"')
  response.setHeader('Cache-Control', 'private, no-store')
  response.send(`\uFEFF${csv}`)
}))

collaborationAdminCommissionsRouter.get('/commissions/reconciliation', adminRateLimit('admin-commission-reconciliation', 10), requireAdminTotp, asyncRoute(async (_request, response) => {
  response.json({ data: await findCommissionReconciliationIssues() })
}))

collaborationAdminCommissionsRouter.get('/commissions/events', adminRateLimit('admin-commission-events', 20), requireAdminTotp, asyncRoute(async (_request, response) => {
  const events = await prisma.collaborationDomainEvent.findMany({
    where: { eventType: 'contract.signed', consumedAt: null },
    orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
    take: 100,
    select: {
      id: true,
      dealId: true,
      attempts: true,
      nextAttemptAt: true,
      lastError: true,
      createdAt: true,
      deal: { select: { saleNumber: true } },
    },
  })
  response.json({ data: events })
}))

collaborationAdminCommissionsRouter.get('/commissions/email-failures', adminRateLimit('admin-commission-email-failures', 20), requireAdminTotp, asyncRoute(async (_request, response) => {
  const jobs = await prisma.collaborationEmailJob.findMany({
    where: { type: 'COMMISSION_PAID', status: 'FAILED' },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      dealId: true,
      attempts: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      deal: { select: { saleNumber: true } },
    },
  })
  response.json({ data: jobs })
}))

collaborationAdminCommissionsRouter.post('/commissions/:commissionId/pay', adminRateLimit('admin-commission-pay', 10), requireAdminTotp, (_request, response) => {
  response.status(409).json({
    error: 'Les commissions sont créditées au portefeuille. Traitez les demandes et références de paiement dans la file des retraits.',
  })
})

collaborationAdminCommissionsRouter.patch('/commissions/:commissionId/decision', adminRateLimit('admin-commission-decision', 10), requireAdminTotp, asyncRoute(async (request, response) => {
  const adminId = request.user!.id
  const commissionId = parseId(request.params.commissionId)
  const body = decisionSchema.safeParse(request.body)
  if (commissionId === null || !body.success
    || (body.data?.action === 'REASSIGN' && body.data.targetAgentId === undefined)
    || (body.data?.action !== 'REASSIGN' && body.data?.targetAgentId !== undefined)) {
    response.status(400).json({ error: 'Décision de commission invalide.', details: body.success ? undefined : body.error.flatten() })
    return
  }
  const audit = requestAudit(request)
  const commissionRef = await prisma.collaborationCommission.findUnique({
    where: { id: commissionId },
    select: { dealId: true },
  })
  if (!commissionRef) {
    response.status(404).json({ error: 'Commission introuvable.' })
    return
  }
  const result = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM collaboration_deals WHERE id = ${commissionRef.dealId} FOR UPDATE`
    await transaction.$queryRaw`SELECT id FROM collaboration_commissions WHERE id = ${commissionId} FOR UPDATE`
    const commission = await transaction.collaborationCommission.findUnique({
      where: { id: commissionId },
      include: {
        deal: { select: { id: true, status: true } },
        agent: { select: { status: true } },
      },
    })
    if (!commission) throw new CollaborationAccessError('Commission introuvable.', 404)
    if (body.data.action === 'RELEASE' && commission.status !== 'ON_HOLD') {
      throw new CollaborationAccessError('Seule une commission en attente de décision peut être libérée.', 409)
    }
    if (body.data.action === 'RELEASE' && commission.agent.status !== 'ACTIF') {
      throw new CollaborationAccessError('L’agent est suspendu; réattribuez la commission à un agent actif ou annulez-la.', 409)
    }
    if (body.data.action === 'CANCEL' && !canResolveHeldCommission(commission.status)) {
      throw new CollaborationAccessError('Une commission payée ou déjà annulée ne peut pas être annulée.', 409)
    }
    if (body.data.action === 'REASSIGN' && commission.status !== 'ON_HOLD') {
      throw new CollaborationAccessError('Seule une commission en litige ou en attente de décision peut être réattribuée.', 409)
    }
    let targetAgentId: number | undefined
    if (body.data.action === 'REASSIGN') {
      targetAgentId = body.data.targetAgentId
      const target = await transaction.user.findFirst({
        where: { id: targetAgentId, role: 'AGENT', status: 'ACTIF' },
        select: { id: true },
      })
      if (!target || target.id === commission.agentId) {
        throw new CollaborationAccessError('Choisissez un autre agent actif.', 409)
      }
    }
    const status = body.data.action === 'CANCEL' ? 'CANCELLED' : 'PENDING'
    const updated = await transaction.collaborationCommission.updateMany({
      where: { id: commission.id, status: commission.status },
      data: {
        status,
        ...(targetAgentId === undefined ? {} : { agentId: targetAgentId }),
        pendingAlertedAt: null,
      },
    })
    if (updated.count !== 1) throw new CollaborationAccessError('La commission a changé; rechargez puis réessayez.', 409)
    await writeCollaborationAudit(transaction, {
      actorId: adminId,
      dealId: commission.dealId,
      action: body.data.action === 'RELEASE'
        ? 'COLLABORATION_COMMISSION_RELEASED'
        : body.data.action === 'CANCEL'
          ? 'COLLABORATION_COMMISSION_CANCELLED'
          : 'COLLABORATION_COMMISSION_REASSIGNED',
      entityType: 'CollaborationCommission',
      entityId: commission.id,
      metadata: {
        fromStatus: commission.status,
        toStatus: status,
        previousAgentId: commission.agentId,
        targetAgentId: targetAgentId ?? commission.agentId,
        reason: body.data.reason,
      },
      ...audit,
    })
    const remaining = await transaction.collaborationCommission.findMany({
      where: { dealId: commission.dealId },
      select: { status: true },
    })
    if (commission.deal.status === 'DISPUTED' && !remaining.some(({ status: itemStatus }) => itemStatus === 'ON_HOLD')) {
      const nextDealStatus = shouldCompleteCommissionsPaid(remaining.map(({ status: itemStatus }) => itemStatus))
        ? 'COMMISSIONS_PAID'
        : 'CONTRACT_SIGNED'
      await transitionCollaborationDeal(
        transaction,
        { id: adminId, role: request.user!.role, status: 'ACTIF' },
        commission.dealId,
        nextDealStatus,
        `Litige résolu par décision admin : ${body.data.reason}`,
      )
    }
    return { status, commissionId: commission.id, agentId: targetAgentId ?? commission.agentId }
  })
  response.json({ data: result })
}))

collaborationAdminCommissionsRouter.post('/commissions/:commissionId/adjustments', adminRateLimit('admin-commission-adjustment', 10), requireAdminTotp, asyncRoute(async (request, response) => {
  const adminId = request.user!.id
  const commissionId = parseId(request.params.commissionId)
  const body = adjustmentSchema.safeParse(request.body)
  if (commissionId === null || !body.success) {
    response.status(400).json({ error: 'Écriture d’ajustement invalide.', details: body.success ? undefined : body.error.flatten() })
    return
  }
  const audit = requestAudit(request)
  const adjustment = await prisma.$transaction(async (transaction) => {
    const commission = await transaction.collaborationCommission.findUnique({ where: { id: commissionId } })
    if (!commission) throw new CollaborationAccessError('Commission introuvable.', 404)
    if (commission.status !== 'PAID') {
      throw new CollaborationAccessError('Un ajustement correctif est réservé à une commission déjà payée.', 409)
    }
    const data = {
      commissionId,
      authorId: adminId,
      amount: BigInt(body.data.amount),
      currency: commission.currency,
      reason: body.data.reason,
      idempotencyKey: body.data.idempotencyKey,
    }
    const inserted = await transaction.collaborationCommissionAdjustment.createMany({
      data,
      skipDuplicates: true,
    })
    const created = await transaction.collaborationCommissionAdjustment.findUniqueOrThrow({
      where: { idempotencyKey: body.data.idempotencyKey },
    })
    if (created.commissionId !== commissionId
      || created.amount !== data.amount
      || created.reason !== data.reason) {
      throw new CollaborationAccessError('Cette clé idempotente correspond à un autre ajustement.', 409)
    }
    if (inserted.count === 0) return { adjustment: created, duplicate: true }
    await writeCollaborationAudit(transaction, {
      actorId: adminId,
      dealId: commission.dealId,
      action: 'COLLABORATION_COMMISSION_ADJUSTED',
      entityType: 'CollaborationCommissionAdjustment',
      entityId: created.id,
      metadata: {
        commissionId,
        amount: created.amount.toString(),
        currency: created.currency,
        reason: created.reason,
        idempotencyKey: created.idempotencyKey,
      },
      ...audit,
    })
    return { adjustment: created, duplicate: false }
  })
  response.status(adjustment.duplicate ? 200 : 201).json({
    data: { ...adjustment.adjustment, amount: adjustment.adjustment.amount.toString(), idempotentReplay: adjustment.duplicate },
  })
}))

collaborationAdminCommissionsRouter.post('/deals/:dealId/disputes', adminRateLimit('admin-commission-dispute', 10), requireAdminTotp, asyncRoute(async (request, response) => {
  const adminId = request.user!.id
  const dealId = parseId(request.params.dealId)
  const body = disputeSchema.safeParse(request.body)
  if (dealId === null || !body.success) {
    response.status(400).json({ error: 'Motif de litige invalide.', details: body.success ? undefined : body.error.flatten() })
    return
  }
  const audit = requestAudit(request)
  await prisma.$transaction(async (transaction) => {
    const deal = await transaction.collaborationDeal.findUnique({
      where: { id: dealId },
      select: { id: true, status: true, contractSignedAt: true },
    })
    if (!deal?.contractSignedAt) throw new CollaborationAccessError('La vente signée est introuvable.', 404)
    await transitionCollaborationDeal(
      transaction,
      { id: adminId, role: request.user!.role, status: 'ACTIF' },
      dealId,
      'DISPUTED',
      body.data.reason,
    )
    await transaction.collaborationDeal.update({ where: { id: dealId }, data: { disputeReason: body.data.reason } })
    await holdPendingCommissionsForDeal(transaction, dealId, 'DEAL_DISPUTED', { actorId: adminId, ...audit })
    await writeCollaborationAudit(transaction, {
      actorId: adminId,
      dealId,
      action: 'COLLABORATION_SIGNED_SALE_DISPUTED',
      entityType: 'CollaborationDeal',
      entityId: dealId,
      metadata: { reason: body.data.reason, previousStatus: deal.status },
      ...audit,
    })
  })
  response.json({ data: { status: 'DISPUTED' } })
}))

collaborationAdminCommissionsRouter.post('/deals/:dealId/dispute-resolution', adminRateLimit('admin-commission-dispute-resolution', 10), requireAdminTotp, asyncRoute(async (request, response) => {
  const adminId = request.user!.id
  const dealId = parseId(request.params.dealId)
  const body = disputeSchema.safeParse(request.body)
  if (dealId === null || !body.success) {
    response.status(400).json({ error: 'Motif de résolution invalide.', details: body.success ? undefined : body.error.flatten() })
    return
  }
  const audit = requestAudit(request)
  const status = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM collaboration_deals WHERE id = ${dealId} FOR UPDATE`
    const deal = await transaction.collaborationDeal.findUnique({
      where: { id: dealId },
      select: { id: true, status: true, contractSignedAt: true },
    })
    if (!deal?.contractSignedAt) throw new CollaborationAccessError('La vente signée est introuvable.', 404)
    if (deal.status !== 'DISPUTED') throw new CollaborationAccessError('Cette vente n’est pas en litige.', 409)
    const commissions = await transaction.collaborationCommission.findMany({
      where: { dealId },
      select: { role: true, agentId: true, amount: true, currency: true, status: true },
    })
    const nextStatus = disputeResolutionStatus(commissions.map(({ status: commissionStatus }) => commissionStatus))
    if (!nextStatus) {
      throw new CollaborationAccessError('Traitez d’abord les deux commissions en attente ou en litige.', 409)
    }
    await transitionCollaborationDeal(
      transaction,
      { id: adminId, role: request.user!.role, status: 'ACTIF' },
      dealId,
      nextStatus,
      `Litige résolu par décision admin : ${body.data.reason}`,
    )
    await writeCollaborationAudit(transaction, {
      actorId: adminId,
      dealId,
      action: 'COLLABORATION_SIGNED_SALE_DISPUTE_RESOLVED',
      entityType: 'CollaborationDeal',
      entityId: dealId,
      metadata: {
        reason: body.data.reason,
        status: nextStatus,
        commissions: commissions.map(({ role, agentId, amount, currency, status: commissionStatus }) => ({
          role,
          agentId,
          amount: amount.toString(),
          currency,
          status: commissionStatus,
        })),
      },
      ...audit,
    })
    return nextStatus
  })
  response.json({ data: { status } })
}))

collaborationAdminCommissionsRouter.get('/commissions/summary', adminRateLimit('admin-commission-summary'), requireAdminTotp, asyncRoute(async (request, response) => {
  const range = parseDateRange(request, response)
  if (!range) return
  const where: Prisma.CollaborationCommissionWhereInput = { generatedAt: dateFilter(range.from, range.to) }
  const [count, byCurrency, byStatus] = await Promise.all([
    prisma.collaborationCommission.count({ where }),
    prisma.collaborationCommission.groupBy({
      by: ['currency'],
      where,
      _sum: { amount: true },
    }),
    prisma.collaborationCommission.groupBy({
      by: ['status', 'currency'],
      where,
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ])
  response.json({
    data: {
      count,
      totalsByCurrency: byCurrency.map(({ currency, _sum }) => ({
        currency,
        amount: (_sum.amount ?? 0n).toString(),
      })),
      byStatus: byStatus.map(({ status, currency, _count, _sum }) => ({
        status,
        currency,
        count: _count._all,
        amount: (_sum.amount ?? 0n).toString(),
      })),
    },
  })
}))

collaborationAdminCommissionsRouter.get('/commissions/:commissionId', adminRateLimit('admin-commission-detail', 30), requireAdminTotp, asyncRoute(async (request, response) => {
  const commissionId = parseId(request.params.commissionId)
  if (commissionId === null) {
    response.status(400).json({ error: 'Identifiant de commission invalide.' })
    return
  }
  const commission = await prisma.collaborationCommission.findUnique({
    where: { id: commissionId },
    include: {
      deal: { select: { id: true, saleNumber: true, status: true } },
      agent: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
      paymentEvidence: { select: { id: true, fileName: true, mimeType: true, fileSize: true, sha256: true, storageKey: true } },
      adjustments: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!commission) {
    response.status(404).json({ error: 'Commission introuvable.' })
    return
  }
  const { paymentEvidence, deal, agent, adjustments, ...commissionData } = commission
  response.json({
    data: {
      ...commissionResponse({ ...commissionData, deal }),
      agent: {
        id: agent.id,
        email: agent.email,
        name: agent.agentProfile ? `${agent.agentProfile.firstName} ${agent.agentProfile.lastName}`.trim() : agent.email,
      },
      paymentEvidence: paymentEvidence ? {
        id: paymentEvidence.id,
        fileName: paymentEvidence.fileName,
        mimeType: paymentEvidence.mimeType,
        fileSize: paymentEvidence.fileSize,
        sha256: paymentEvidence.sha256,
        downloadUrl: createSignedEvidenceUrl(paymentEvidence.id, paymentEvidence.storageKey),
      } : null,
      adjustments: adjustments.map(({ amount, ...adjustment }) => ({ ...adjustment, amount: amount.toString() })),
    },
  })
}))

import type { CollaborationCommissionRole, CollaborationCommissionStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { prisma } from '../../lib/prisma.js'
import { notifyAdmins } from '../notifications/notifications.service.js'
import { writeCollaborationAudit } from './collaboration.audit.js'
import {
  amountForCommissionRole,
  hasExactlyExpectedCommissionRecipients,
  isCommissionGenerationReady,
  validateCommissionConfig,
} from './collaboration.commissions.policy.js'

const eventBatchSize = 50
const eventCommissionConfigSchema = z.object({
  commissionConfig: z.object({
    providerAmount: z.string().regex(/^\d+$/),
    closerAmount: z.string().regex(/^\d+$/),
    currency: z.string(),
  }).strict(),
}).passthrough()

function commissionConfig() {
  return validateCommissionConfig({
    providerAmount: env.commissionProviderAmount,
    closerAmount: env.commissionCloserAmount,
    currency: env.commissionCurrency,
  })
}

function commissionConfigForEvent(payload: Prisma.JsonValue) {
  const parsed = eventCommissionConfigSchema.safeParse(payload)
  if (!parsed.success) {
    if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      && 'commissionConfig' in payload) {
      throw new Error('contract.signed event commission configuration snapshot is invalid.')
    }
    return commissionConfig()
  }
  return validateCommissionConfig({
    providerAmount: Number(parsed.data.commissionConfig.providerAmount),
    closerAmount: Number(parsed.data.commissionConfig.closerAmount),
    currency: parsed.data.commissionConfig.currency,
  })
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : 'Unknown commission event processing error.').slice(0, 1000)
}

export async function processContractSignedEvent(eventId: number, now = new Date()) {
  return prisma.$transaction(async (transaction) => {
    const [lockedEvent] = await transaction.$queryRaw<{ id: number }[]>`
      SELECT id FROM collaboration_domain_events WHERE id = ${eventId} FOR UPDATE
    `
    if (!lockedEvent) return { processed: false, created: 0 }

    const event = await transaction.collaborationDomainEvent.findUnique({ where: { id: eventId } })
    if (!event || event.eventType !== 'contract.signed' || event.consumedAt !== null || event.nextAttemptAt > now) {
      return { processed: false, created: 0 }
    }
    await transaction.$queryRaw`SELECT id FROM collaboration_deals WHERE id = ${event.dealId} FOR UPDATE`
    const deal = await transaction.collaborationDeal.findUnique({
      where: { id: event.dealId },
      include: {
        supplier: { select: { id: true, status: true } },
        closer: { select: { id: true, status: true } },
      },
    })
    if (!deal || !isCommissionGenerationReady(deal) || !deal.closer) {
      throw new Error(`contract.signed event ${event.id} does not reference a fully signed sale with two agents.`)
    }
    const config = commissionConfigForEvent(event.payload)
    const before = await transaction.collaborationCommission.findMany({
      where: { dealId: deal.id },
      select: { role: true, agentId: true },
    })
    const existingRoles = new Set(before.map(({ role }) => role))
    const initialStatus: CollaborationCommissionStatus =
      deal.status === 'DISPUTED' || deal.supplier.status !== 'ACTIF' || deal.closer.status !== 'ACTIF'
        ? 'ON_HOLD'
        : 'PENDING'
    const roles: { role: CollaborationCommissionRole; agentId: number }[] = [
      { role: 'SUPPLIER', agentId: deal.supplier.id },
      { role: 'CLOSER', agentId: deal.closer.id },
    ]
    const missing = roles.filter(({ role }) => !existingRoles.has(role))
    if (missing.length) {
      await transaction.collaborationCommission.createMany({
        data: missing.map(({ role, agentId }) => ({
          dealId: deal.id,
          agentId,
          role,
          amount: amountForCommissionRole(role, config),
          currency: config.currency,
          status: initialStatus,
        })),
        skipDuplicates: true,
      })
    }
    const commissions = await transaction.collaborationCommission.findMany({
      where: { dealId: deal.id },
      orderBy: { role: 'asc' },
      select: { id: true, role: true, agentId: true, amount: true, currency: true, status: true },
    })
    if (!hasExactlyExpectedCommissionRecipients(commissions, deal.supplierId, deal.closerId)) {
      throw new Error(`Signed sale ${deal.saleNumber} does not have exactly the expected supplier and closer commissions.`)
    }
    for (const commission of commissions) {
      if (before.some(({ role }) => role === commission.role)) continue
      await writeCollaborationAudit(transaction, {
        dealId: deal.id,
        action: 'COLLABORATION_COMMISSION_GENERATED',
        entityType: 'CollaborationCommission',
        entityId: commission.id,
        metadata: {
          role: commission.role,
          agentId: commission.agentId,
          amount: commission.amount.toString(),
          currency: commission.currency,
          saleNumber: deal.saleNumber,
        },
        createdAt: now,
      })
      if (commission.status === 'ON_HOLD') {
        await writeCollaborationAudit(transaction, {
          dealId: deal.id,
          action: 'COLLABORATION_COMMISSION_PUT_ON_HOLD',
          entityType: 'CollaborationCommission',
          entityId: commission.id,
          metadata: {
            reason: deal.status === 'DISPUTED' ? 'DISPUTED_SALE' : 'AGENT_SUSPENDED',
            saleNumber: deal.saleNumber,
          },
          createdAt: now,
        })
      }
    }
    await transaction.collaborationDomainEvent.update({
      where: { id: event.id },
      data: { consumedAt: now, lastError: null },
    })
    return { processed: true, created: missing.length }
  })
}

async function recordCommissionEventFailure(eventId: number, now: Date, error: unknown) {
  const message = errorMessage(error)
  const result = await prisma.$transaction(async (transaction) => {
    const event = await transaction.collaborationDomainEvent.findUnique({ where: { id: eventId } })
    if (!event || event.consumedAt) return null
    const attempts = event.attempts + 1
    const delayMinutes = Math.min(24 * 60, 2 ** Math.min(attempts - 1, 10))
    await transaction.collaborationDomainEvent.update({
      where: { id: event.id },
      data: {
        attempts,
        nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000),
        lastError: message,
        lastAlertedAt: now,
      },
    })
    await writeCollaborationAudit(transaction, {
      dealId: event.dealId,
      action: 'COLLABORATION_COMMISSION_EVENT_RETRY_SCHEDULED',
      entityType: 'CollaborationDomainEvent',
      entityId: event.id,
      metadata: { eventType: event.eventType, attempts, nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000).toISOString(), error: message },
      createdAt: now,
    })
    return { dealId: event.dealId, attempts, message }
  })
  if (result) {
    console.error(`Commission event ${eventId} failed; retry ${result.attempts} scheduled: ${result.message}`)
    await notifyAdmins({
      type: 'COLLABORATION_COMMISSION_GENERATION_FAILED',
      title: 'Génération de commission à réessayer',
      body: `Une vente signée n’a pas encore généré ses commissions. Tentative ${result.attempts}; l’événement sera réessayé automatiquement.`,
      link: `/admin/collaboration/commissions/events`,
    })
  }
}

export async function processPendingContractSignedEvents(now = new Date()) {
  const events = await prisma.collaborationDomainEvent.findMany({
    where: { eventType: 'contract.signed', consumedAt: null, nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
    take: eventBatchSize,
    select: { id: true },
  })
  for (const event of events) {
    try {
      await processContractSignedEvent(event.id, now)
    } catch (error) {
      await recordCommissionEventFailure(event.id, now, error)
    }
  }
}

export async function holdPendingCommissionsForDeal(
  transaction: Prisma.TransactionClient,
  dealId: number,
  reason: string,
  audit: { actorId?: number | null; ip?: string | null; userAgent?: string | null } = {},
  now = new Date(),
) {
  const pending = await transaction.collaborationCommission.findMany({
    where: { dealId, status: 'PENDING' },
    select: { id: true, agentId: true, role: true },
  })
  for (const commission of pending) {
    const update = await transaction.collaborationCommission.updateMany({
      where: { id: commission.id, status: 'PENDING' },
      data: { status: 'ON_HOLD', pendingAlertedAt: null },
    })
    if (update.count !== 1) continue
    await writeCollaborationAudit(transaction, {
      actorId: audit.actorId,
      dealId,
      action: 'COLLABORATION_COMMISSION_PUT_ON_HOLD',
      entityType: 'CollaborationCommission',
      entityId: commission.id,
      metadata: { reason, role: commission.role, agentId: commission.agentId },
      ip: audit.ip,
      userAgent: audit.userAgent,
      createdAt: now,
    })
  }
  return pending.length
}

export async function holdCommissionsForSuspendedAgents(now = new Date()) {
  const pending = await prisma.collaborationCommission.findMany({
    where: { status: 'PENDING', agent: { status: 'SUSPENDU' } },
    select: { id: true, dealId: true, agentId: true, role: true },
    orderBy: { generatedAt: 'asc' },
    take: eventBatchSize,
  })
  for (const commission of pending) {
    await prisma.$transaction(async (transaction) => {
      const update = await transaction.collaborationCommission.updateMany({
        where: { id: commission.id, status: 'PENDING', agent: { status: 'SUSPENDU' } },
        data: { status: 'ON_HOLD', pendingAlertedAt: null },
      })
      if (update.count !== 1) return
      await writeCollaborationAudit(transaction, {
        dealId: commission.dealId,
        action: 'COLLABORATION_COMMISSION_PUT_ON_HOLD',
        entityType: 'CollaborationCommission',
        entityId: commission.id,
        metadata: { reason: 'AGENT_SUSPENDED', role: commission.role, agentId: commission.agentId },
        createdAt: now,
      })
    })
  }
}

export async function findCommissionReconciliationIssues() {
  const signedDeals = await prisma.collaborationDeal.findMany({
    where: { contractSignedAt: { not: null } },
    select: {
      id: true,
      saleNumber: true,
      supplierId: true,
      closerId: true,
      commissions: { select: { id: true, role: true, agentId: true } },
    },
    orderBy: { contractSignedAt: 'asc' },
  })
  return signedDeals.flatMap((deal) => {
    const issues: string[] = []
    if (!deal.saleNumber) issues.push('SALE_NUMBER_MISSING')
    if (deal.closerId === null) issues.push('MISSING_CLOSER')
    if (deal.commissions.length !== 2) issues.push('COMMISSION_COUNT_NOT_TWO')
    if (!deal.commissions.some(({ role, agentId }) => role === 'SUPPLIER' && agentId === deal.supplierId)) {
      issues.push('SUPPLIER_COMMISSION_MISSING_OR_MISASSIGNED')
    }
    if (deal.closerId !== null
      && !deal.commissions.some(({ role, agentId }) => role === 'CLOSER' && agentId === deal.closerId)) {
      issues.push('CLOSER_COMMISSION_MISSING_OR_MISASSIGNED')
    }
    return issues.length ? [{ dealId: deal.id, saleNumber: deal.saleNumber, issues }] : []
  })
}

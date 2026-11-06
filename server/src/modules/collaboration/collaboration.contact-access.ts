import type { Prisma } from '@prisma/client'
import { env } from '../../config/env.js'
import { writeCollaborationAudit } from './collaboration.audit.js'

const burstWindowMs = env.collaborationContactBurstWindowMinutes * 60_000
const dedupAction = 'COLLABORATION_CONTACT_VIEW_QUOTA_CHARGED'
const viewedAction = 'COLLABORATION_CONTACT_DETAILS_VIEWED'

function assertLimit(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`)
}

export async function recordCollaborationContactAccess(
  transaction: Prisma.TransactionClient,
  input: {
    agentId: number
    dealId: number
    role: 'SUPPLIER' | 'CLOSER'
    ip?: string | null
    userAgent?: string | null
    now?: Date
  },
) {
  assertLimit(env.collaborationContactDailyLimit, 'COLLABORATION_CONTACT_DAILY_LIMIT')
  assertLimit(env.collaborationContactBurstLimit, 'COLLABORATION_CONTACT_BURST_LIMIT')
  assertLimit(env.collaborationContactBurstWindowMinutes, 'COLLABORATION_CONTACT_BURST_WINDOW_MINUTES')
  assertLimit(env.contactViewDedupMinutes, 'CONTACT_VIEW_DEDUP_MINUTES')
  const now = input.now ?? new Date()
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dedupSince = new Date(now.getTime() - env.contactViewDedupMinutes * 60_000)
  const previousCharge = await transaction.collaborationAuditLog.findFirst({
    where: {
      actorId: input.agentId,
      dealId: input.dealId,
      action: dedupAction,
      createdAt: { gte: dedupSince },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  const deduplicated = previousCharge !== null
  let counter = await transaction.collaborationContactAccessCounter.upsert({
    where: { agentId_day: { agentId: input.agentId, day } },
    create: { agentId: input.agentId, day, count: 0 },
    update: {},
  })

  if (!deduplicated) {
    const [lockedCounter] = await transaction.$queryRaw<Array<{
      id: number
      count: number
      burst_alerted_at: Date | null
    }>>`SELECT id, \`count\`, burst_alerted_at FROM collaboration_contact_access_counters WHERE id = ${counter.id} FOR UPDATE`
    if (!lockedCounter) throw new Error('Contact access counter disappeared while locked.')
    counter = {
      ...counter,
      count: lockedCounter.count,
      burstAlertedAt: lockedCounter.burst_alerted_at,
    }

    if (counter.count >= env.collaborationContactDailyLimit) {
      const alert = await transaction.collaborationContactAccessCounter.updateMany({
        where: { id: counter.id, dailyAlertedAt: null },
        data: { dailyAlertedAt: now },
      })
      await writeCollaborationAudit(transaction, {
        actorId: input.agentId,
        actorRole: 'AGENT',
        dealId: input.dealId,
        action: 'COLLABORATION_CONTACT_DAILY_LIMIT_REACHED',
        entityType: 'CollaborationDeal',
        entityId: input.dealId,
        metadata: { count: counter.count, limit: env.collaborationContactDailyLimit },
        ip: input.ip,
        userAgent: input.userAgent,
        createdAt: now,
      })
      return { allowed: false, alertAdmin: alert.count === 1, reason: 'DAILY_LIMIT' as const, deduplicated: false }
    }

    counter = await transaction.collaborationContactAccessCounter.update({
      where: { id: counter.id },
      data: { count: { increment: 1 } },
    })
    await writeCollaborationAudit(transaction, {
      actorId: input.agentId,
      actorRole: 'AGENT',
      dealId: input.dealId,
      action: dedupAction,
      entityType: 'CollaborationDeal',
      entityId: input.dealId,
      metadata: { role: input.role, deduplicationWindowMinutes: env.contactViewDedupMinutes },
      ip: input.ip,
      userAgent: input.userAgent,
      createdAt: now,
    })
  }

  await writeCollaborationAudit(transaction, {
    actorId: input.agentId,
    actorRole: 'AGENT',
    dealId: input.dealId,
    action: viewedAction,
    entityType: 'CollaborationDeal',
    entityId: input.dealId,
    metadata: { role: input.role, quotaDeduplicated: deduplicated },
    ip: input.ip,
    userAgent: input.userAgent,
    createdAt: now,
  })

  const recentViews = await transaction.collaborationAuditLog.count({
    where: {
      actorId: input.agentId,
      action: viewedAction,
      createdAt: { gte: new Date(now.getTime() - burstWindowMs) },
    },
  })
  if (recentViews < env.collaborationContactBurstLimit || counter.burstAlertedAt) {
    return { allowed: true, alertAdmin: false, reason: null, deduplicated }
  }

  const alert = await transaction.collaborationContactAccessCounter.updateMany({
    where: { id: counter.id, burstAlertedAt: null },
    data: { burstAlertedAt: now },
  })
  if (alert.count === 1) {
    await writeCollaborationAudit(transaction, {
      actorId: input.agentId,
      actorRole: 'AGENT',
      dealId: input.dealId,
      action: 'COLLABORATION_CONTACT_ACCESS_BURST_DETECTED',
      entityType: 'CollaborationDeal',
      entityId: input.dealId,
      metadata: { count: recentViews, windowMinutes: env.collaborationContactBurstWindowMinutes },
      ip: input.ip,
      userAgent: input.userAgent,
      createdAt: now,
    })
  }
  return { allowed: true, alertAdmin: alert.count === 1, reason: alert.count === 1 ? 'BURST' as const : null, deduplicated }
}

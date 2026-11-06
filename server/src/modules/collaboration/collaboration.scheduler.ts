import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { env } from '../../config/env.js'
import { isEmailDeliveryConfigured, sendCollaborationEmail } from '../../lib/email.js'
import { prisma } from '../../lib/prisma.js'
import { notifyAdmins, notifyUser, publishNotification } from '../notifications/notifications.service.js'
import { getCollaborationConfig } from './collaboration.config.js'
import { enqueueCollaborationEmail } from './collaboration.outbox.js'
import { CollaborationAccessError, transitionCollaborationDeal } from './collaboration.policy.js'
import { writeCollaborationAudit } from './collaboration.audit.js'
import { createAvailabilityNotifications } from './collaboration.notifications.js'
import { verifyAuditChainIfNightlyWindow } from './collaboration.audit-verification.js'
import { alertContactExtractionAnomalies, detectSignedContactBypass } from './collaboration.risk.service.js'
import { recalculateCollaborationTrustScores } from './collaboration.trust.service.js'
import { decryptPii, maskContactName } from './report-pii.js'
import { holdCommissionsForSuspendedAgents, processPendingContractSignedEvents } from './collaboration.commissions.service.js'

const emailPayloadSchema = z.discriminatedUnion('audience', [
  z.object({
    audience: z.enum(['supplier', 'requester']),
    recipientName: z.string(),
    prospectName: z.string(),
    requesterName: z.string().optional(),
    deadline: z.string().datetime().optional(),
    link: z.string().url(),
  }).strict(),
  z.object({
    audience: z.literal('client'),
    codeCiphertext: z.string().startsWith('v1:'),
    confirmationUrlCiphertext: z.string().startsWith('v1:'),
  }).strict(),
  z.object({
    audience: z.literal('commission'),
    recipientName: z.string(),
    saleNumber: z.string(),
    role: z.enum(['SUPPLIER', 'CLOSER']),
    amount: z.string().regex(/^\d+$/),
    currency: z.string(),
    paymentMode: z.enum(['MVOLA', 'ORANGE_MONEY', 'AIRTEL_MONEY', 'BANK_TRANSFER', 'CASH']),
    paymentReference: z.string(),
    paidAt: z.string().datetime(),
  }).strict(),
])

const batchSize = 50
const maxEmailAttempts = 5
const schedulerLeaseMs = 10 * 60_000

async function runNightlyCollaborationChecks(now: Date) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Indian/Antananarivo',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now))
  if (hour < 2) return
  await Promise.all([
    detectSignedContactBypass(now),
    alertContactExtractionAnomalies(now),
    recalculateCollaborationTrustScores(now),
  ])
}

function displayName(profile: { firstName: string; lastName: string } | null, fallback: string): string {
  return profile ? `${profile.firstName} ${profile.lastName}`.trim() : fallback
}

function maskedProspect(ciphertext: string | null): string {
  if (!ciphertext) throw new Error('Collaboration prospect name ciphertext is missing.')
  return maskContactName(decryptPii(ciphertext))
}

async function expireAccessRequests(now: Date) {
  const expired = await prisma.collaborationAccessRequest.findMany({
    where: { status: 'PENDING', expiresAt: { lte: now } },
    orderBy: { expiresAt: 'asc' },
    take: batchSize,
    include: {
      requester: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
      deal: {
        include: {
          secret: { select: { contactNameCiphertext: true } },
          supplier: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
  })
  for (const candidate of expired) {
    const outcome = await prisma.$transaction(async (transaction) => {
      const update = await transaction.collaborationAccessRequest.updateMany({
        where: { id: candidate.id, status: 'PENDING', expiresAt: { lte: now } },
        data: { status: 'EXPIRED', pendingKey: null, decidedAt: now },
      })
      if (update.count !== 1) return false
      const remaining = await transaction.collaborationAccessRequest.count({
        where: { dealId: candidate.dealId, status: 'PENDING' },
      })
      if (remaining === 0) {
        const deal = await transaction.collaborationDeal.findUniqueOrThrow({
          where: { id: candidate.dealId },
          select: { status: true },
        })
        if (deal.status === 'ACCESS_REQUESTED') {
          await transitionCollaborationDeal(
            transaction,
            { role: 'SYSTEM' },
            candidate.dealId,
            'DECLARED',
            'Toutes les demandes d’accès ont expiré.',
            now,
          )
        }
      }
      const name = maskedProspect(candidate.deal.secret?.contactNameCiphertext ?? null)
      const requesterName = displayName(candidate.requester.agentProfile, candidate.requester.email)
      const supplierName = displayName(candidate.deal.supplier.agentProfile, candidate.deal.supplier.email)
      await Promise.all([
        enqueueCollaborationEmail(transaction, {
          dealId: candidate.dealId,
          type: 'ACCESS_REQUEST_EXPIRED',
          recipient: candidate.requester.email,
          idempotencyKey: `access-expired:${candidate.id}:requester`,
          payload: { audience: 'requester', recipientName: requesterName, prospectName: name, link: env.agentAppUrl },
        }),
        enqueueCollaborationEmail(transaction, {
          dealId: candidate.dealId,
          type: 'ACCESS_REQUEST_EXPIRED',
          recipient: candidate.deal.supplier.email,
          idempotencyKey: `access-expired:${candidate.id}:supplier`,
          payload: { audience: 'supplier', recipientName: supplierName, prospectName: name, requesterName, link: env.agentAppUrl },
        }),
      ])
      return true
    })
    if (outcome) {
      await Promise.all([
        notifyUser(candidate.requester.id, {
          type: 'COLLABORATION_ACCESS_EXPIRED',
          title: 'Demande expirée',
          body: 'Votre demande d’accès au prospect a expiré sans décision.',
          link: `/collaboration/${candidate.dealId}`,
        }),
        notifyUser(candidate.deal.supplier.id, {
          type: 'COLLABORATION_ACCESS_EXPIRED',
          title: 'Demande expirée',
          body: 'Une demande d’accès à votre prospect a expiré sans décision.',
          link: `/collaboration/${candidate.dealId}/access-requests`,
        }),
      ])
    }
  }
}

async function sendAccessReminders(now: Date, reminderAfterHours: number) {
  const reminderCutoff = new Date(now.getTime() - reminderAfterHours * 60 * 60 * 1000)
  const pending = await prisma.collaborationAccessRequest.findMany({
    where: {
      status: 'PENDING',
      reminderSentAt: null,
      requestedAt: { lte: reminderCutoff },
      expiresAt: { gt: now },
    },
    orderBy: { requestedAt: 'asc' },
    take: batchSize,
    include: {
      deal: {
        include: {
          secret: { select: { contactNameCiphertext: true } },
          supplier: { select: { email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
        },
      },
      requester: { select: { agentProfile: { select: { firstName: true, lastName: true } } } },
    },
  })
  for (const candidate of pending) {
    await prisma.$transaction(async (transaction) => {
      const update = await transaction.collaborationAccessRequest.updateMany({
        where: { id: candidate.id, status: 'PENDING', reminderSentAt: null, expiresAt: { gt: now } },
        data: { reminderSentAt: now },
      })
      if (update.count !== 1) return
      await enqueueCollaborationEmail(transaction, {
        dealId: candidate.dealId,
        type: 'ACCESS_REQUEST_REMINDER',
        recipient: candidate.deal.supplier.email,
        idempotencyKey: `access-reminder:${candidate.id}`,
        payload: {
          audience: 'supplier',
          recipientName: displayName(candidate.deal.supplier.agentProfile, candidate.deal.supplier.email),
          prospectName: maskedProspect(candidate.deal.secret?.contactNameCiphertext ?? null),
          requesterName: displayName(candidate.requester.agentProfile, 'Un agent'),
          deadline: candidate.expiresAt.toISOString(),
          link: env.agentAppUrl,
        },
      })
    })
  }
}

async function expireCloserAccess(now: Date) {
  const expiredDeals = await prisma.collaborationDeal.findMany({
    where: { status: 'IN_PROGRESS', accessExpiresAt: { lte: now }, closerId: { not: null } },
    orderBy: { accessExpiresAt: 'asc' },
    take: batchSize,
    include: {
      secret: { select: { contactNameCiphertext: true } },
      supplier: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
      closer: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
    },
  })
  for (const candidate of expiredDeals) {
    const outcome = await prisma.$transaction(async (transaction) => {
      try {
        await transitionCollaborationDeal(transaction, { role: 'SYSTEM' }, candidate.id, 'EXPIRED', 'La période d’accès du closer est terminée.', now)
      } catch (error) {
        if (error instanceof CollaborationAccessError && error.statusCode === 409) return false
        throw error
      }
      const availabilityNotifications = await createAvailabilityNotifications(
        transaction,
        candidate.id,
        [candidate.supplier.id, ...(candidate.closer ? [candidate.closer.id] : [])],
      )
      const closerName = displayName(candidate.closer?.agentProfile ?? null, candidate.closer?.email ?? 'Agent')
      const prospect = maskedProspect(candidate.secret?.contactNameCiphertext ?? null)
      await Promise.all([
        ...(candidate.closer ? [enqueueCollaborationEmail(transaction, {
          dealId: candidate.id,
          type: 'ACCESS_EXPIRED',
          recipient: candidate.closer.email,
          idempotencyKey: `closer-access-expired:${candidate.id}`,
          payload: { audience: 'requester', recipientName: closerName, prospectName: prospect, link: env.agentAppUrl },
        })] : []),
        enqueueCollaborationEmail(transaction, {
          dealId: candidate.id,
          type: 'ACCESS_EXPIRED',
          recipient: candidate.supplier.email,
          idempotencyKey: `supplier-access-expired:${candidate.id}`,
          payload: {
            audience: 'supplier',
            recipientName: displayName(candidate.supplier.agentProfile, candidate.supplier.email),
            prospectName: prospect,
            requesterName: closerName,
            link: env.agentAppUrl,
          },
        }),
      ])
      return { availabilityNotifications }
    })
    if (outcome) {
      outcome.availabilityNotifications.forEach((notification) => publishNotification(notification))
      await Promise.all([
        ...(candidate.closer ? [notifyUser(candidate.closer.id, {
          type: 'COLLABORATION_ACCESS_EXPIRED',
          title: 'Accès au prospect terminé',
          body: 'Votre période d’accès à ce prospect est terminée.',
          link: `/collaboration/${candidate.id}`,
        })] : []),
        notifyUser(candidate.supplier.id, {
          type: 'COLLABORATION_ACCESS_EXPIRED',
          title: 'Accès au prospect terminé',
          body: 'La période d’accès du closer à votre prospect est terminée.',
          link: `/collaboration/${candidate.id}`,
        }),
      ])
    }
  }
}

async function expireClientConfirmations(now: Date) {
  const expired = await prisma.collaborationClientConfirmation.findMany({
    where: { status: 'PENDING', expiresAt: { lte: now } },
    orderBy: { expiresAt: 'asc' },
    take: batchSize,
    select: { id: true, dealId: true },
  })
  for (const candidate of expired) {
    const changed = await prisma.$transaction(async (transaction) => {
      const update = await transaction.collaborationClientConfirmation.updateMany({
        where: { id: candidate.id, status: 'PENDING', expiresAt: { lte: now } },
        data: { status: 'NO_RESPONSE', respondedAt: now },
      })
      if (update.count !== 1) return false
      const deal = await transaction.collaborationDeal.findUniqueOrThrow({
        where: { id: candidate.dealId },
        select: { status: true },
      })
      if (deal.status === 'CLOSING_REPORTED') {
        await transitionCollaborationDeal(
          transaction,
          { role: 'SYSTEM' },
          candidate.dealId,
          'NO_RESPONSE',
          'Le client n’a pas répondu dans le délai de confirmation.',
          now,
        )
      }
      await writeCollaborationAudit(transaction, {
        dealId: candidate.dealId,
        action: 'CLIENT_CONFIRMATION_NO_RESPONSE',
        entityType: 'CollaborationClientConfirmation',
        entityId: candidate.id,
        metadata: { expiresAt: now.toISOString() },
        createdAt: now,
      })
      return true
    })
    if (changed) {
      await notifyAdmins({
        type: 'COLLABORATION_CLIENT_NO_RESPONSE',
        title: 'Aucune réponse du client',
        body: 'La période de confirmation client est terminée; le dossier attend la décision de l’administration.',
        link: `/admin/collaboration/${candidate.dealId}`,
      }).catch((error: unknown) => console.error('Failed to notify after client confirmation expiry:', error))
    }
  }
}

async function deliverQueuedEmails(now: Date) {
  const staleLock = new Date(now.getTime() - 10 * 60 * 1000)
  await prisma.collaborationEmailJob.updateMany({
    where: { status: 'SENDING', lockedAt: { lt: staleLock } },
    data: { status: 'QUEUED', lockedAt: null, nextAttemptAt: now, lastError: 'Previous email worker attempt was interrupted.' },
  })
  const jobs = await prisma.collaborationEmailJob.findMany({
    where: { status: 'QUEUED', nextAttemptAt: { lte: now } },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  })
  for (const candidate of jobs) {
    const claim = await prisma.collaborationEmailJob.updateMany({
      where: { id: candidate.id, status: 'QUEUED', nextAttemptAt: { lte: now } },
      data: { status: 'SENDING', lockedAt: now, attempts: { increment: 1 } },
    })
    if (claim.count !== 1) continue
    const job = await prisma.collaborationEmailJob.findUniqueOrThrow({ where: { id: candidate.id } })
    if (job.status !== 'SENDING') continue
    let deliveryError: unknown = null
    let deliveryFailed = false
    try {
      if (!isEmailDeliveryConfigured()) throw new Error('SMTP is not configured.')
      const payload = emailPayloadSchema.parse(job.payload)
      const emailPayload = payload.audience === 'client'
        ? {
          audience: payload.audience,
          code: decryptPii(payload.codeCiphertext),
          confirmationUrl: decryptPii(payload.confirmationUrlCiphertext),
        }
        : payload
      await sendCollaborationEmail(decryptPii(job.recipientCiphertext), job.type, emailPayload)
    } catch (error) {
      deliveryFailed = true
      deliveryError = error
    }
    if (deliveryFailed) {
      const failedPermanently = job.attempts >= maxEmailAttempts
      const delayMinutes = Math.min(60, 2 ** Math.max(0, job.attempts - 1))
      await prisma.$transaction(async (transaction) => {
        await transaction.collaborationEmailJob.update({
          where: { id: job.id },
          data: {
            status: failedPermanently ? 'FAILED' : 'QUEUED',
            lockedAt: null,
            nextAttemptAt: new Date(now.getTime() + delayMinutes * 60 * 1000),
            lastError: deliveryError instanceof Error ? deliveryError.message.slice(0, 1000) : 'Unknown email delivery error.',
          },
        })
        await writeCollaborationAudit(transaction, {
          actorRole: 'SYSTEM',
          dealId: job.dealId,
          action: 'COLLABORATION_EMAIL_FAILED',
          entityType: 'CollaborationEmailJob',
          entityId: job.id,
          metadata: {
            type: job.type,
            attempts: job.attempts,
            willRetry: !failedPermanently,
            errorType: deliveryError instanceof Error ? deliveryError.name : 'UnknownError',
          },
        })
      })
      console.error(`Collaboration email job ${job.id} failed${failedPermanently ? ' permanently' : '; retry scheduled'}:`, deliveryError)
      if (failedPermanently && job.type === 'COMMISSION_PAID') {
        await notifyAdmins({
          type: 'COLLABORATION_COMMISSION_EMAIL_FAILED',
          title: 'Email de reçu de commission non distribué',
          body: 'Après plusieurs tentatives, le reçu de paiement n’a pas pu être envoyé à l’agent.',
          link: '/admin/collaboration/commissions/email-failures',
        })
      }
      continue
    }
    await prisma.$transaction(async (transaction) => {
      await transaction.collaborationEmailJob.update({
        where: { id: job.id },
        data: { status: 'SENT', sentAt: new Date(), lockedAt: null, lastError: null },
      })
      await writeCollaborationAudit(transaction, {
        actorRole: 'SYSTEM',
        dealId: job.dealId,
        action: 'COLLABORATION_EMAIL_SENT',
        entityType: 'CollaborationEmailJob',
        entityId: job.id,
        metadata: { type: job.type, attempts: job.attempts },
      })
    })
  }
}

export async function runCollaborationSchedulerCycle(now = new Date()) {
  const ownerToken = randomBytes(32).toString('hex')
  const expiresAt = new Date(now.getTime() + schedulerLeaseMs)
  await prisma.$executeRaw`
    INSERT INTO collaboration_scheduler_locks (name, owner_token, expires_at, updated_at)
    VALUES ('collaboration-scheduler', ${ownerToken}, ${expiresAt}, ${now})
    ON DUPLICATE KEY UPDATE
      owner_token = IF(expires_at IS NULL OR expires_at <= VALUES(updated_at), VALUES(owner_token), owner_token),
      expires_at = IF(owner_token = VALUES(owner_token), VALUES(expires_at), expires_at),
      updated_at = IF(owner_token = VALUES(owner_token), VALUES(updated_at), updated_at)
  `
  const lock = await prisma.collaborationSchedulerLock.findUnique({ where: { name: 'collaboration-scheduler' } })
  if (lock?.ownerToken !== ownerToken) return

  const heartbeat = setInterval(() => {
    const heartbeatAt = new Date()
    void prisma.collaborationSchedulerLock.updateMany({
      where: { name: 'collaboration-scheduler', ownerToken },
      data: { expiresAt: new Date(heartbeatAt.getTime() + schedulerLeaseMs), updatedAt: heartbeatAt },
    }).catch((error: unknown) => console.error('Failed to renew collaboration scheduler lease:', error))
  }, Math.floor(schedulerLeaseMs / 3))
  try {
    const config = await prisma.$transaction((transaction) => getCollaborationConfig(transaction))
    await Promise.all([
      expireAccessRequests(now),
      sendAccessReminders(now, config.reminderAfterHours),
      expireCloserAccess(now),
      expireClientConfirmations(now),
      processPendingContractSignedEvents(now),
      holdCommissionsForSuspendedAgents(now),
      deliverQueuedEmails(now),
      verifyAuditChainIfNightlyWindow(ownerToken, now),
      runNightlyCollaborationChecks(now),
    ])
    await prisma.collaborationRateLimitBucket.deleteMany({
      where: { windowStartedAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } },
    })
  } finally {
    clearInterval(heartbeat)
    await prisma.collaborationSchedulerLock.updateMany({
      where: { name: 'collaboration-scheduler', ownerToken },
      data: { ownerToken: null, expiresAt: null, updatedAt: new Date() },
    })
  }
}

export function startCollaborationScheduler() {
  let running = false
  let currentCycle: Promise<void> | null = null
  const timer = setInterval(() => {
    if (running) return
    running = true
    currentCycle = runCollaborationSchedulerCycle()
      .catch((error: unknown) => console.error('Collaboration scheduler cycle failed:', error))
      .finally(() => {
        running = false
        currentCycle = null
      })
  }, 60_000)
  return async () => {
    clearInterval(timer)
    await currentCycle
  }
}

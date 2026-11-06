import { CollaborationAccessStatus } from '@prisma/client'
import type { CollaborationEmailType, Prisma } from '@prisma/client'
import { Router } from 'express'
import type { Request, RequestHandler, Response } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { prisma } from '../../lib/prisma.js'
import type { AuthRequest, AuthUser } from '../auth/auth.middleware.js'
import { notifyUser, publishNotification } from '../notifications/notifications.service.js'
import { notifyAdmins } from '../notifications/notifications.service.js'
import { getCollaborationConfig } from './collaboration.config.js'
import {
  CollaborationAccessError,
  canManageCollaborationAccess,
  canRequestCollaborationAccess,
  findCollaborationDealForActor,
  isSignedCollaborationStatus,
  transitionCollaborationDeal,
} from './collaboration.policy.js'
import { createAvailabilityNotifications } from './collaboration.notifications.js'
import { enqueueCollaborationEmail } from './collaboration.outbox.js'
import { writeCollaborationAudit } from './collaboration.audit.js'
import { recordCollaborationContactAccess } from './collaboration.contact-access.js'
import { decryptPii, maskContactName, serializeMaskedCollaborationReport } from './report-pii.js'
import { collaborationRateLimit } from './collaboration.rate-limit.js'
import { removeCollaborationFile } from './collaboration.files.js'

const requestSchema = z.object({ message: z.string().trim().max(500).optional() }).strict()
const decisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']) }).strict()
const successfulSaleStatuses = ['CONTRACT_SIGNED', 'COMMISSIONS_PAID'] as const

type ActiveActor = AuthUser & {
  email: string
  firstName: string
  lastName: string
}

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

async function loadActor(request: AuthRequest, response: Response): Promise<ActiveActor | null> {
  if (!request.user) {
    response.status(401).json({ error: 'Authentification requise' })
    return null
  }
  const user = await prisma.user.findUnique({
    where: { id: request.user.id },
    select: {
      id: true,
      role: true,
      status: true,
      email: true,
      agentProfile: { select: { firstName: true, lastName: true } },
    },
  })
  if (!user || user.status !== 'ACTIF') {
    response.status(403).json({ error: 'Un compte agent actif est requis.' })
    return null
  }
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    email: user.email,
    firstName: user.agentProfile?.firstName ?? user.email,
    lastName: user.agentProfile?.lastName ?? '',
  }
}

function ensureAgent(actor: ActiveActor, response: Response): boolean {
  if (actor.role === 'AGENT') return true
  response.status(403).json({ error: 'Cette action est réservée aux agents.' })
  return false
}

function fullName(actor: Pick<ActiveActor, 'firstName' | 'lastName' | 'email'>): string {
  return `${actor.firstName} ${actor.lastName}`.trim() || actor.email
}

function auditContext(request: Request) {
  return { ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null }
}

async function alertContactAccess(agentId: number, dealId: number, reason: string) {
  await notifyAdmins({
    type: 'COLLABORATION_CONTACT_ACCESS_ANOMALY',
    title: 'Comportement inhabituel de consultation de coordonnées',
    body: `Une limite de consultation a été atteinte par l’agent ${agentId} (dossier ${dealId}, ${reason}).`,
    link: '/admin/collaboration/audit',
  })
}

async function successfulSalesByAgent(agentIds: number[]): Promise<Map<number, number>> {
  const ids = [...new Set(agentIds)]
  const counts = new Map(ids.map((id) => [id, 0]))
  if (!ids.length) return counts
  const deals = await prisma.collaborationDeal.findMany({
    where: {
      status: { in: [...successfulSaleStatuses] },
      OR: [{ supplierId: { in: ids } }, { closerId: { in: ids } }],
    },
    select: { id: true, supplierId: true, closerId: true },
  })
  const countedDeals = new Map<number, Set<number>>()
  for (const deal of deals) {
    for (const agentId of new Set([deal.supplierId, deal.closerId].filter((id): id is number => id !== null))) {
      if (!counts.has(agentId)) continue
      const agentDeals = countedDeals.get(agentId) ?? new Set<number>()
      agentDeals.add(deal.id)
      countedDeals.set(agentId, agentDeals)
    }
  }
  for (const [agentId, agentDeals] of countedDeals) counts.set(agentId, agentDeals.size)
  return counts
}

function parseId(value: string | string[]): number | null {
  if (typeof value !== 'string') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function prospectName(ciphertext: string): string {
  return maskContactName(decryptPii(ciphertext))
}

function emailPayload(
  audience: 'supplier' | 'requester',
  recipientName: string,
  name: string,
  requesterName?: string,
  deadline?: Date,
) {
  return {
    audience,
    recipientName,
    prospectName: name,
    ...(requesterName === undefined ? {} : { requesterName }),
    ...(deadline === undefined ? {} : { deadline: deadline.toISOString() }),
    link: env.agentAppUrl,
  }
}

async function enqueueAccessEmail(
  transaction: Prisma.TransactionClient,
  input: {
    dealId: number
    type: CollaborationEmailType
    recipient: string
    idempotencyKey: string
    audience: 'supplier' | 'requester'
    recipientName: string
    prospectName: string
    requesterName?: string
    deadline?: Date
  },
) {
  return enqueueCollaborationEmail(transaction, {
    dealId: input.dealId,
    type: input.type,
    recipient: input.recipient,
    idempotencyKey: input.idempotencyKey,
    payload: emailPayload(input.audience, input.recipientName, input.prospectName, input.requesterName, input.deadline),
  })
}

export const collaborationRouter = Router()

collaborationRouter.get('/closer/accesses', collaborationRateLimit({ scope: 'closer-access-list', limit: 60, windowMs: 60_000 }), asyncRoute(async (request, response) => {
  const actor = await loadActor(request, response)
  if (!actor || !ensureAgent(actor, response)) return
  const now = new Date()
  const deals = await prisma.collaborationDeal.findMany({
    where: {
      closerId: actor.id,
      OR: [
        {
          status: { in: ['IN_PROGRESS', 'CLOSING_REPORTED', 'CLIENT_CONFIRMED', 'NO_RESPONSE', 'CONFIRMED'] },
          accessGrantedAt: { lte: now },
          accessExpiresAt: { gt: now },
        },
        { status: { in: ['CONTRACT_SIGNED', 'COMMISSIONS_PAID'] } },
      ],
      accessRequests: {
        some: { requesterId: actor.id, status: 'APPROVED', decidedAt: { not: null } },
      },
      report: { reportType: 'LEAD', status: { not: 'REJETE' } },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 200,
    select: {
      id: true,
      status: true,
      accessExpiresAt: true,
      secret: { select: { contactNameCiphertext: true } },
      report: {
        select: {
          city: true,
          reportNature: true,
          reportType: true,
          meetingAt: true,
          createdAt: true,
        },
      },
      closingReport: { select: { status: true } },
    },
  })
  response.setHeader('Cache-Control', 'no-store')
  response.json({
    data: deals.map((deal) => ({
      dealId: deal.id,
      dealStatus: deal.status,
      prospectName: deal.secret?.contactNameCiphertext
        ? maskContactName(decryptPii(deal.secret.contactNameCiphertext))
        : 'Prospect',
      city: deal.report.city,
      reportNature: deal.report.reportNature,
      reportType: deal.report.reportType,
      meetingAt: deal.report.meetingAt,
      createdAt: deal.report.createdAt,
      accessExpiresAt: deal.accessExpiresAt,
      closingReportStatus: deal.closingReport?.status ?? 'NONE',
    })),
  })
}))

collaborationRouter.get('/prospects', asyncRoute(async (request, response) => {
  const actor = await loadActor(request, response)
  if (!actor || !ensureAgent(actor, response)) return
  const config = await getCollaborationConfig(prisma)
  const deals = await prisma.collaborationDeal.findMany({
    where: {
      supplierId: { not: actor.id },
      status: { in: ['DECLARED', 'ACCESS_REQUESTED', 'EXPIRED', 'LOST', 'CONTRACT_SIGNED', 'COMMISSIONS_PAID'] },
      hiddenByAgents: { none: { agentId: actor.id } },
      report: { reportType: 'LEAD', status: { not: 'REJETE' } },
    },
    orderBy: { declaredAt: 'desc' },
    take: 100,
    include: {
      secret: { select: { contactNameCiphertext: true } },
      report: {
        select: {
          id: true,
          city: true,
          reportNature: true,
          reportType: true,
          meetingAt: true,
          createdAt: true,
          status: true,
          agent: {
            select: {
              id: true,
              agentProfile: { select: { firstName: true, lastName: true } },
              collaborationTrustScoreSnapshots: {
                orderBy: { calculatedAt: 'desc' },
                take: 1,
                select: { score: true, calculatedAt: true },
              },
            },
          },
        },
      },
      accessRequests: {
        where: { requesterId: actor.id },
        orderBy: { requestedAt: 'desc' },
        take: 1,
        select: { id: true, status: true, requestedAt: true, expiresAt: true },
      },
      _count: {
        select: {
          accessRequests: { where: { requesterId: actor.id } },
        },
      },
    },
  })
  response.json({
    data: deals.map((deal) => {
      const latestRequest = deal.accessRequests[0] ?? null
      const canRetry = latestRequest !== null
        && latestRequest.status !== CollaborationAccessStatus.PENDING
        && deal._count.accessRequests < config.maxAccessAttempts
      const nextRequestAt = canRetry
        ? new Date(latestRequest.requestedAt.getTime() + config.requestCooldownHours * 60 * 60 * 1000)
        : null
      if (isSignedCollaborationStatus(deal.status)) {
        return {
          dealId: deal.id,
          prospectName: 'Prospect clôturé',
          city: '',
          reportNature: '',
          reportType: 'LEAD',
          meetingAt: deal.report.meetingAt,
          createdAt: deal.report.createdAt,
          status: 'CLOSED_SIGNED',
          supplier: { name: 'Fournisseur' },
          supplierTrustScore: null,
          dealStatus: 'CLOSED_SIGNED',
          myRequest: null,
          nextRequestAt: null,
        }
      }
      return {
        ...serializeMaskedCollaborationReport({
          dealId: deal.id,
          ...deal.report,
          contactName: deal.secret?.contactNameCiphertext
            ? decryptPii(deal.secret.contactNameCiphertext)
            : 'Prospect',
        }),
        dealStatus: deal.status,
        supplierTrustScore: deal.report.agent.collaborationTrustScoreSnapshots[0] ?? null,
        myRequest: latestRequest ? { ...latestRequest, nextRequestAt } : null,
      }
    }),
  })
}))

collaborationRouter.post('/prospects/:dealId/hide', asyncRoute(async (request, response) => {
  const actor = await loadActor(request, response)
  if (!actor || !ensureAgent(actor, response)) return
  const dealId = parseId(request.params.dealId)
  if (dealId === null) {
    response.status(400).json({ error: 'Identifiant de prospect invalide.' })
    return
  }
  const audit = auditContext(request)
  const hidden = await prisma.$transaction(async (transaction) => {
    const lockedDeals = await transaction.$queryRaw<Array<{ status: string; supplier_id: number; closer_id: number | null }>>`
      SELECT status, supplier_id, closer_id FROM collaboration_deals WHERE id = ${dealId} FOR UPDATE
    `
    const deal = lockedDeals[0]
    if (!deal) throw new CollaborationAccessError('Prospect introuvable.', 404)
    if (deal.status !== 'CONTRACT_SIGNED' && deal.status !== 'COMMISSIONS_PAID') {
      throw new CollaborationAccessError('Le retrait est uniquement possible après signature du contrat.', 409)
    }
    if (deal.supplier_id === actor.id || deal.closer_id === actor.id) {
      throw new CollaborationAccessError('Les agents concernés gardent leur accès à ce dossier.', 409)
    }
    const existing = await transaction.collaborationHiddenDeal.findUnique({
      where: { dealId_agentId: { dealId, agentId: actor.id } },
      select: { hiddenAt: true },
    })
    if (existing) return existing
    const record = await transaction.collaborationHiddenDeal.create({
      data: { dealId, agentId: actor.id },
    })
    await writeCollaborationAudit(transaction, {
      actorId: actor.id,
      actorRole: actor.role,
      dealId,
      action: 'COLLABORATION_SIGNED_PROSPECT_HIDDEN',
      entityType: 'CollaborationHiddenDeal',
      entityId: dealId,
      metadata: { agentId: actor.id },
      ...audit,
    })
    return record
  })
  response.json({ data: { hidden: true, hiddenAt: hidden.hiddenAt } })
}))

collaborationRouter.get('/mine', asyncRoute(async (request, response) => {
  const actor = await loadActor(request, response)
  if (!actor || !ensureAgent(actor, response)) return
  const now = new Date()
  const deals = await prisma.collaborationDeal.findMany({
    where: {
      OR: [
        { supplierId: actor.id },
        {
          closerId: actor.id,
          status: {
            in: ['IN_PROGRESS', 'CLOSING_REPORTED', 'CLIENT_CONFIRMED', 'NO_RESPONSE', 'CONFIRMED', 'CONTRACT_SIGNED', 'COMMISSIONS_PAID'],
          },
          accessGrantedAt: { lte: now },
          accessExpiresAt: { gt: now },
          accessRequests: { some: { requesterId: actor.id, status: 'APPROVED', decidedAt: { not: null } } },
          report: { status: { not: 'REJETE' } },
        },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      report: {
        select: {
          id: true,
          city: true,
          reportNature: true,
          reportType: true,
          meetingAt: true,
          createdAt: true,
          status: true,
          contactType: true,
          contactRole: true,
          summary: true,
          interestLevel: true,
          nextStep: true,
        },
      },
      secret: true,
      accessRequests: {
        where: { requesterId: actor.id },
        orderBy: { requestedAt: 'desc' },
        take: 1,
        select: { id: true, status: true, requestedAt: true, expiresAt: true },
      },
    },
  })
  for (const deal of deals) {
    const outcome = await prisma.$transaction((transaction) => recordCollaborationContactAccess(transaction, {
      agentId: actor.id,
      dealId: deal.id,
      role: deal.supplierId === actor.id ? 'SUPPLIER' : 'CLOSER',
      ...auditContext(request),
    }))
    if (outcome.alertAdmin) await alertContactAccess(actor.id, deal.id, outcome.reason ?? 'BURST')
    if (!outcome.allowed) {
      response.status(429).json({ error: 'Limite quotidienne de consultation des coordonnées atteinte.' })
      return
    }
  }
  response.json({
    data: deals.map(({ report, accessRequests, ...deal }) => ({
      dealId: deal.id,
      dealStatus: deal.status,
      role: deal.supplierId === actor.id ? 'SUPPLIER' : 'CLOSER',
      accessExpiresAt: deal.accessExpiresAt,
      myRequest: accessRequests[0] ?? null,
      watermark: { agentId: actor.id, agentName: fullName(actor) },
      report,
      prospect: deal.secret ? {
        companyName: decryptPii(deal.secret.companyNameCiphertext),
        contactName: decryptPii(deal.secret.contactNameCiphertext),
        phone: decryptPii(deal.secret.phoneCiphertext),
        email: deal.secret.emailCiphertext ? decryptPii(deal.secret.emailCiphertext) : null,
        address: deal.secret.addressCiphertext ? decryptPii(deal.secret.addressCiphertext) : null,
      } : null,
    })),
  })
}))

collaborationRouter.get('/supplied', collaborationRateLimit({ scope: 'supplier-deal-list', limit: 60, windowMs: 60_000 }), asyncRoute(async (request, response) => {
  const actor = await loadActor(request, response)
  if (!actor || !ensureAgent(actor, response)) return
  const now = new Date()
  const deals = await prisma.collaborationDeal.findMany({
    where: { supplierId: actor.id, report: { reportType: 'LEAD' } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 200,
    select: {
      id: true,
      status: true,
      declaredAt: true,
      updatedAt: true,
      secret: { select: { contactNameCiphertext: true } },
      report: { select: { city: true, reportNature: true, createdAt: true } },
      _count: {
        select: {
          accessRequests: { where: { status: 'PENDING', expiresAt: { gt: now } } },
        },
      },
    },
  })
  response.json({
    data: deals.map((deal) => ({
      dealId: deal.id,
      status: deal.status,
      declaredAt: deal.declaredAt,
      updatedAt: deal.updatedAt,
      prospectName: deal.secret?.contactNameCiphertext
        ? prospectName(deal.secret.contactNameCiphertext)
        : 'Prospect',
      city: deal.report.city,
      reportNature: deal.report.reportNature,
      reportCreatedAt: deal.report.createdAt,
      pendingRequestsCount: deal._count.accessRequests,
    })),
  })
}))

collaborationRouter.get('/:dealId', asyncRoute(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Pragma', 'no-cache')
  response.setHeader('Expires', '0')
  const actor = await loadActor(request, response)
  if (!actor || !ensureAgent(actor, response)) return
  const dealId = parseId(request.params.dealId)
  if (dealId === null) {
    response.status(400).json({ error: 'Identifiant de prospect invalide.' })
    return
  }
  let auditAlert = false
  try {
    const outcome = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM collaboration_deals WHERE id = ${dealId} FOR UPDATE`
      const authorized = await findCollaborationDealForActor(transaction, actor, dealId)
      const access = await recordCollaborationContactAccess(transaction, {
        agentId: actor.id,
        dealId: authorized.id,
        role: authorized.supplierId === actor.id ? 'SUPPLIER' : 'CLOSER',
        ...auditContext(request),
      })
      if (!access.allowed) {
        return { data: null, limited: true, alertAdmin: access.alertAdmin, reason: access.reason }
      }
      const deal = await transaction.collaborationDeal.findUniqueOrThrow({
        where: { id: authorized.id },
        include: { report: true, secret: true },
      })
      const details = {
        dealId: deal.id,
        dealStatus: deal.status,
        supplierId: deal.supplierId,
        closerId: deal.closerId,
        accessExpiresAt: deal.accessExpiresAt,
        watermark: { agentId: actor.id, agentName: fullName(actor) },
        report: {
          id: deal.report.id,
          city: deal.report.city,
          reportNature: deal.report.reportNature,
          reportType: deal.report.reportType,
          meetingAt: deal.report.meetingAt,
          createdAt: deal.report.createdAt,
          status: deal.report.status,
          contactType: deal.report.contactType,
          contactRole: deal.report.contactRole,
          summary: deal.report.summary,
          interestLevel: deal.report.interestLevel,
          nextStep: deal.report.nextStep,
        },
        prospect: deal.secret ? {
          companyName: decryptPii(deal.secret.companyNameCiphertext),
          contactName: decryptPii(deal.secret.contactNameCiphertext),
          phone: decryptPii(deal.secret.phoneCiphertext),
          email: deal.secret.emailCiphertext ? decryptPii(deal.secret.emailCiphertext) : null,
          address: deal.secret.addressCiphertext ? decryptPii(deal.secret.addressCiphertext) : null,
        } : null,
      }
      return { data: details, limited: false, alertAdmin: access.alertAdmin, reason: access.reason }
    })
    auditAlert = outcome.alertAdmin
    if (auditAlert) await alertContactAccess(actor.id, dealId, outcome.reason ?? 'BURST')
    if (outcome.limited) {
      response.status(429).json({ error: 'Limite quotidienne de consultation des coordonnées atteinte.' })
      return
    }
    response.json({ data: outcome.data })
  } catch (error) {
    if (error instanceof CollaborationAccessError && error.statusCode === 404) {
      await prisma.$transaction((transaction) => writeCollaborationAudit(transaction, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'COLLABORATION_CONTACT_ACCESS_DENIED',
        entityType: 'CollaborationDeal',
        entityId: dealId,
        metadata: { reason: 'NO_AUTHORIZED_ACCESS' },
        ...auditContext(request),
      }))
    }
    throw error
  }
}))

collaborationRouter.get('/access-requests/pending', collaborationRateLimit({ scope: 'supplier-pending-requests', limit: 60, windowMs: 60_000 }), asyncRoute(async (request, response) => {
  const actor = await loadActor(request, response)
  if (!actor || !ensureAgent(actor, response)) return
  const now = new Date()
  const requests = await prisma.collaborationAccessRequest.findMany({
    where: {
      status: 'PENDING',
      expiresAt: { gt: now },
      deal: {
        supplierId: actor.id,
        report: { reportType: 'LEAD', status: { not: 'REJETE' } },
      },
    },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    take: 200,
    select: {
      id: true,
      dealId: true,
      requestedAt: true,
      expiresAt: true,
      requester: {
        select: {
          id: true,
          agentProfile: { select: { firstName: true, lastName: true } },
          collaborationTrustScoreSnapshots: {
            orderBy: { calculatedAt: 'desc' },
            take: 1,
            select: { score: true, calculatedAt: true },
          },
        },
      },
      deal: { select: { secret: { select: { contactNameCiphertext: true } } } },
    },
  })
  const salesCounts = await successfulSalesByAgent(requests.map(({ requester }) => requester.id))
  response.json({
    data: requests.map(({ requester, deal, ...accessRequest }) => ({
      ...accessRequest,
      prospectName: deal.secret?.contactNameCiphertext
        ? prospectName(deal.secret.contactNameCiphertext)
        : 'Prospect',
      requester: {
        id: requester.id,
        name: requester.agentProfile
          ? `${requester.agentProfile.firstName} ${requester.agentProfile.lastName}`.trim()
          : 'Agent',
        trustScore: requester.collaborationTrustScoreSnapshots[0] ?? null,
        successfulSales: salesCounts.get(requester.id) ?? 0,
      },
    })),
  })
}))

collaborationRouter.get('/:dealId/access-requests', collaborationRateLimit({ scope: 'supplier-deal-requests', limit: 60, windowMs: 60_000 }), asyncRoute(async (request, response) => {
  const actor = await loadActor(request, response)
  if (!actor) return
  const dealId = parseId(request.params.dealId)
  if (dealId === null) {
    response.status(400).json({ error: 'Identifiant de prospect invalide.' })
    return
  }
  const deal = await prisma.collaborationDeal.findUnique({ where: { id: dealId }, select: { id: true, supplierId: true } })
  if (!deal || !canManageCollaborationAccess(actor, deal)) {
    response.status(404).json({ error: 'Prospect introuvable.' })
    return
  }
  const accessRequests = await prisma.collaborationAccessRequest.findMany({
    where: { dealId },
    orderBy: { requestedAt: 'desc' },
    include: {
      requester: {
        select: {
          id: true,
          agentProfile: { select: { firstName: true, lastName: true, city: true } },
          collaborationTrustScoreSnapshots: {
            orderBy: { calculatedAt: 'desc' },
            take: 1,
            select: { score: true, calculatedAt: true },
          },
        },
      },
    },
  })
  const salesCounts = await successfulSalesByAgent(accessRequests.map(({ requester }) => requester.id))
  response.json({
    data: accessRequests.map(({ requester, ...accessRequest }) => ({
      ...accessRequest,
      requester: {
        id: requester.id,
        name: requester.agentProfile
          ? `${requester.agentProfile.firstName} ${requester.agentProfile.lastName}`.trim()
          : 'Agent',
        city: requester.agentProfile?.city ?? null,
        trustScore: requester.collaborationTrustScoreSnapshots[0] ?? null,
        successfulSales: salesCounts.get(requester.id) ?? 0,
      },
    })),
  })
}))

collaborationRouter.post('/:dealId/access-requests', asyncRoute(async (request, response) => {
  const actor = await loadActor(request, response)
  if (!actor || !ensureAgent(actor, response)) return
  const dealId = parseId(request.params.dealId)
  if (dealId === null) {
    response.status(400).json({ error: 'Identifiant de prospect invalide.' })
    return
  }
  const body = requestSchema.safeParse(request.body)
  if (!body.success) {
    response.status(400).json({ error: 'Demande invalide.', details: body.error.flatten() })
    return
  }
  const now = new Date()
  const created = await prisma.$transaction(async (transaction) => {
    const lockedDeals = await transaction.$queryRaw<Array<{ status: string }>>`SELECT status FROM collaboration_deals WHERE id = ${dealId} FOR UPDATE`
    if (lockedDeals[0] && (lockedDeals[0].status === 'CONTRACT_SIGNED' || lockedDeals[0].status === 'COMMISSIONS_PAID')) {
      throw new CollaborationAccessError('Prospect déjà signé', 409)
    }
    const deal = await transaction.collaborationDeal.findUnique({
      where: { id: dealId },
      include: {
        supplier: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
        secret: { select: { contactNameCiphertext: true } },
        report: { select: { reportType: true, status: true } },
      },
    })
    if (!deal || deal.report.reportType !== 'LEAD' || deal.report.status === 'REJETE' || !canRequestCollaborationAccess(actor, deal)) {
      throw new CollaborationAccessError('Ce prospect n’est pas disponible pour une demande.', deal ? 409 : 404)
    }
    const config = await getCollaborationConfig(transaction)
    const requests = await transaction.collaborationAccessRequest.findMany({
      where: { dealId, requesterId: actor.id },
      orderBy: { requestedAt: 'desc' },
      select: { status: true, requestedAt: true },
    })
    if (requests.some(({ status }) => status === 'PENDING')) {
      throw new CollaborationAccessError('Une demande est déjà en attente pour ce prospect.', 409)
    }
    if (requests.length >= config.maxAccessAttempts) {
      throw new CollaborationAccessError('Le nombre maximal de demandes pour ce prospect est atteint.', 409)
    }
    const latestRequest = requests[0]
    if (latestRequest && now.getTime() - latestRequest.requestedAt.getTime() < config.requestCooldownHours * 60 * 60 * 1000) {
      throw new CollaborationAccessError('Veuillez attendre avant de demander à nouveau l’accès à ce prospect.', 409)
    }
    const expiresAt = new Date(now.getTime() + config.requestWindowHours * 60 * 60 * 1000)
    const accessRequest = await transaction.collaborationAccessRequest.create({
      data: {
        dealId,
        requesterId: actor.id,
        pendingKey: `${dealId}:${actor.id}`,
        message: body.data.message || null,
        requestedAt: now,
        expiresAt,
      },
    })
    if (deal.status !== 'ACCESS_REQUESTED') {
      await transitionCollaborationDeal(transaction, actor, dealId, 'ACCESS_REQUESTED', 'Demande d’accès envoyée.', now)
    }
    await enqueueAccessEmail(transaction, {
      dealId,
      type: 'ACCESS_REQUESTED',
      recipient: deal.supplier.email,
      idempotencyKey: `access-requested:${accessRequest.id}`,
      audience: 'supplier',
      recipientName: deal.supplier.agentProfile
        ? `${deal.supplier.agentProfile.firstName} ${deal.supplier.agentProfile.lastName}`.trim()
        : deal.supplier.email,
      prospectName: prospectName(deal.secret?.contactNameCiphertext ?? ''),
      requesterName: fullName(actor),
      deadline: expiresAt,
    })
    return { accessRequest, supplierId: deal.supplierId }
  })
  await notifyUser(created.supplierId, {
    type: 'COLLABORATION_ACCESS_REQUESTED',
    title: 'Nouvelle demande d’accès',
    body: `${fullName(actor)} demande l’accès à un prospect que vous avez partagé.`,
    link: `/collaboration/${dealId}/access-requests`,
    actorId: actor.id,
  })
  response.status(201).json({ data: created.accessRequest })
}))

collaborationRouter.patch('/access-requests/:requestId', asyncRoute(async (request, response) => {
  const actor = await loadActor(request, response)
  if (!actor) return
  const requestId = parseId(request.params.requestId)
  if (requestId === null) {
    response.status(400).json({ error: 'Identifiant de demande invalide.' })
    return
  }
  const body = decisionSchema.safeParse(request.body)
  if (!body.success) {
    response.status(400).json({ error: 'Décision invalide.', details: body.error.flatten() })
    return
  }
  const now = new Date()
  const result = await prisma.$transaction(async (transaction) => {
    const accessRequest = await transaction.collaborationAccessRequest.findUnique({
      where: { id: requestId },
      include: {
        deal: {
          include: {
            report: { select: { id: true, agentId: true, contactName: true, status: true } },
            secret: { select: { contactNameCiphertext: true } },
            supplier: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
          },
        },
        requester: {
          select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true } } },
        },
      },
    })
    if (!accessRequest) {
      throw new CollaborationAccessError('Demande introuvable.', 404)
    }
    const currentDeal = await transaction.$queryRaw<Array<{ status: string }>>`SELECT status FROM collaboration_deals WHERE id = ${accessRequest.dealId} FOR UPDATE`
    if (currentDeal[0] && (currentDeal[0].status === 'CONTRACT_SIGNED' || currentDeal[0].status === 'COMMISSIONS_PAID')) {
      throw new CollaborationAccessError('Prospect déjà signé', 409)
    }
    if (accessRequest.deal.report.status === 'REJETE' || !canManageCollaborationAccess(actor, accessRequest.deal)) {
      throw new CollaborationAccessError('Demande introuvable.', 404)
    }
    if (accessRequest.status !== 'PENDING' || accessRequest.deal.status !== 'ACCESS_REQUESTED') {
      throw new CollaborationAccessError('Cette demande a déjà été traitée ou n’est plus disponible.', 409)
    }
    if (accessRequest.expiresAt <= now) {
      await transaction.collaborationAccessRequest.update({
        where: { id: requestId },
        data: { status: 'EXPIRED', pendingKey: null, decidedAt: now },
      })
      const remaining = await transaction.collaborationAccessRequest.count({
        where: { dealId: accessRequest.dealId, status: 'PENDING' },
      })
      if (remaining === 0) {
        await transitionCollaborationDeal(transaction, { role: 'SYSTEM' }, accessRequest.dealId, 'DECLARED', 'Toutes les demandes en attente ont expiré.', now)
      }
      await enqueueAccessEmail(transaction, {
        dealId: accessRequest.dealId,
        type: 'ACCESS_REQUEST_EXPIRED',
        recipient: accessRequest.requester.email,
        idempotencyKey: `access-expired:${requestId}:requester`,
        audience: 'requester',
        recipientName: accessRequest.requester.agentProfile
          ? `${accessRequest.requester.agentProfile.firstName} ${accessRequest.requester.agentProfile.lastName}`.trim()
          : accessRequest.requester.email,
        prospectName: prospectName(accessRequest.deal.secret?.contactNameCiphertext ?? ''),
      })
      await enqueueAccessEmail(transaction, {
        dealId: accessRequest.dealId,
        type: 'ACCESS_REQUEST_EXPIRED',
        recipient: accessRequest.deal.supplier.email,
        idempotencyKey: `access-expired:${requestId}:supplier`,
        audience: 'supplier',
        recipientName: accessRequest.deal.supplier.agentProfile
          ? `${accessRequest.deal.supplier.agentProfile.firstName} ${accessRequest.deal.supplier.agentProfile.lastName}`.trim()
          : accessRequest.deal.supplier.email,
        prospectName: prospectName(accessRequest.deal.secret?.contactNameCiphertext ?? ''),
        requesterName: accessRequest.requester.agentProfile
          ? `${accessRequest.requester.agentProfile.firstName} ${accessRequest.requester.agentProfile.lastName}`.trim()
          : accessRequest.requester.email,
      })
      return {
        outcome: 'EXPIRED' as const,
        requesterId: accessRequest.requesterId,
        supplierId: accessRequest.deal.supplierId,
      }
    }

    const updated = await transaction.collaborationAccessRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: {
        status: body.data.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        pendingKey: null,
        decidedAt: now,
        decidedById: actor.id,
      },
    })
    if (updated.count !== 1) throw new CollaborationAccessError('Cette demande a déjà été traitée.', 409)

    const contactName = prospectName(accessRequest.deal.secret?.contactNameCiphertext ?? '')
    const requesterName = accessRequest.requester.agentProfile
      ? `${accessRequest.requester.agentProfile.firstName} ${accessRequest.requester.agentProfile.lastName}`.trim()
      : accessRequest.requester.email
    if (body.data.decision === 'REJECT') {
      const remaining = await transaction.collaborationAccessRequest.count({
        where: { dealId: accessRequest.dealId, status: 'PENDING' },
      })
      if (remaining === 0) {
        await transitionCollaborationDeal(transaction, { role: 'SYSTEM' }, accessRequest.dealId, 'DECLARED', 'Aucune demande d’accès ne reste en attente.', now)
      }
      await enqueueAccessEmail(transaction, {
        dealId: accessRequest.dealId,
        type: 'ACCESS_REQUEST_REJECTED',
        recipient: accessRequest.requester.email,
        idempotencyKey: `access-rejected:${requestId}`,
        audience: 'requester',
        recipientName: requesterName,
        prospectName: contactName,
      })
      return { outcome: 'REJECTED' as const, requesterId: accessRequest.requesterId }
    }

    const config = await getCollaborationConfig(transaction)
    const accessExpiresAt = new Date(now.getTime() + config.accessDurationDays * 24 * 60 * 60 * 1000)
    const oldDraft = await transaction.collaborationClosingReport.findUnique({
      where: { dealId: accessRequest.dealId },
      include: { evidence: { select: { id: true, storageKey: true } } },
    })
    const staleDraftStorageKeys: string[] = []
    if (oldDraft?.status === 'DRAFT' && oldDraft.closerId !== accessRequest.requesterId) {
      staleDraftStorageKeys.push(...oldDraft.evidence.map(({ storageKey }) => storageKey))
      await transaction.collaborationEvidence.deleteMany({ where: { closingReportId: oldDraft.id } })
      await transaction.collaborationClosingReport.delete({ where: { id: oldDraft.id } })
      await writeCollaborationAudit(transaction, {
        actorId: actor.id,
        dealId: accessRequest.dealId,
        action: 'COLLABORATION_LOST_DRAFT_REPLACED',
        entityType: 'CollaborationClosingReport',
        entityId: oldDraft.id,
        metadata: { previousCloserId: oldDraft.closerId, deletedEvidenceCount: oldDraft.evidence.length },
      })
    }
    const dealClaim = await transaction.collaborationDeal.updateMany({
      where: { id: accessRequest.dealId, status: 'ACCESS_REQUESTED', closerId: null },
      data: { closerId: accessRequest.requesterId, accessGrantedAt: now, accessExpiresAt },
    })
    if (dealClaim.count !== 1) throw new CollaborationAccessError('Un autre agent a déjà été sélectionné.', 409)
    const notSelected = await transaction.collaborationAccessRequest.findMany({
      where: { dealId: accessRequest.dealId, id: { not: requestId }, status: 'PENDING' },
      select: { id: true, requesterId: true },
    })
    if (notSelected.length) {
      await transaction.collaborationAccessRequest.updateMany({
        where: { id: { in: notSelected.map(({ id }) => id) }, status: 'PENDING' },
        data: { status: 'NOT_SELECTED', pendingKey: null, decidedAt: now, decidedById: actor.id },
      })
    }
    await transitionCollaborationDeal(
      transaction,
      actor,
      accessRequest.dealId,
      'IN_PROGRESS',
      'Un agent a été sélectionné pour conclure le prospect.',
      now,
    )
    await enqueueAccessEmail(transaction, {
      dealId: accessRequest.dealId,
      type: 'ACCESS_GRANTED',
      recipient: accessRequest.requester.email,
      idempotencyKey: `access-granted:${requestId}`,
      audience: 'requester',
      recipientName: requesterName,
      prospectName: contactName,
      deadline: accessExpiresAt,
    })
    for (const otherRequest of notSelected) {
      const other = await transaction.user.findUniqueOrThrow({
        where: { id: otherRequest.requesterId },
        select: { email: true, agentProfile: { select: { firstName: true, lastName: true } } },
      })
      await enqueueAccessEmail(transaction, {
        dealId: accessRequest.dealId,
        type: 'ACCESS_REQUEST_NOT_SELECTED',
        recipient: other.email,
        idempotencyKey: `access-not-selected:${otherRequest.id}`,
        audience: 'requester',
        recipientName: other.agentProfile
          ? `${other.agentProfile.firstName} ${other.agentProfile.lastName}`.trim()
          : other.email,
        prospectName: contactName,
      })
    }
    return {
      outcome: 'APPROVED' as const,
      requesterId: accessRequest.requesterId,
      notSelectedIds: notSelected.map(({ requesterId }) => requesterId),
      accessExpiresAt,
      staleDraftStorageKeys,
    }
  })

  if (result.outcome === 'APPROVED') {
    await Promise.all(result.staleDraftStorageKeys.map((storageKey) =>
      removeCollaborationFile(storageKey).catch((error: unknown) => {
        console.error('Failed to remove replaced lost-draft attachment:', error)
      }),
    ))
  }

  if (result.outcome === 'EXPIRED') {
    await notifyUser(result.requesterId, {
      type: 'COLLABORATION_ACCESS_EXPIRED',
      title: 'Demande expirée',
      body: 'Votre demande d’accès au prospect a expiré sans décision.',
      link: `/collaboration/${requestId}`,
    })
    await notifyUser(result.supplierId, {
      type: 'COLLABORATION_ACCESS_EXPIRED',
      title: 'Demande expirée',
      body: 'Une demande d’accès à votre prospect a expiré sans décision.',
      link: `/collaboration/${requestId}`,
    })
    response.status(409).json({ error: 'Cette demande a expiré.' })
    return
  }
  if (result.outcome === 'REJECTED') {
    await notifyUser(result.requesterId, {
      type: 'COLLABORATION_ACCESS_REJECTED',
      title: 'Demande refusée',
      body: 'Votre demande d’accès au prospect n’a pas été acceptée.',
      link: `/collaboration/${requestId}`,
    })
  } else {
    await notifyUser(result.requesterId, {
      type: 'COLLABORATION_ACCESS_GRANTED',
      title: 'Accès accepté',
      body: 'Votre accès au prospect est activé pour une durée limitée.',
      link: `/collaboration/${requestId}`,
    })
    await Promise.all(result.notSelectedIds.map((userId) => notifyUser(userId, {
      type: 'COLLABORATION_ACCESS_NOT_SELECTED',
      title: 'Mise à jour de la demande',
      body: 'Un autre agent a été sélectionné pour collaborer sur ce prospect.',
      link: `/collaboration/${requestId}`,
    })))
  }
  response.json({ data: { status: body.data.decision === 'APPROVE' ? CollaborationAccessStatus.APPROVED : CollaborationAccessStatus.REJECTED, ...('accessExpiresAt' in result ? { accessExpiresAt: result.accessExpiresAt } : {}) } })
}))

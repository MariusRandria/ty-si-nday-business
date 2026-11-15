import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import { Router } from 'express'
import type { Request, RequestHandler, Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { env } from '../../config/env.js'
import { prisma } from '../../lib/prisma.js'
import { isEmailDeliveryConfigured, sendSalesTeamInvitationEmail } from '../../lib/email.js'
import type { AuthRequest } from '../auth/auth.middleware.js'
import {
  requireAdminTotp,
  requireSalesReviewTotp,
  requireSalesSignatureTotp,
  requireSalesTeamTotp,
  createTotpEnrollment,
  encryptTotpSecret,
  verifyTotp,
} from './admin-totp.js'
import { writeCollaborationAudit } from './collaboration.audit.js'
import { assignCollaborationDealToLeastLoadedStaff } from './collaboration.assignments.js'
import { collaborationRateLimit } from './collaboration.rate-limit.js'
import { createSignedEvidenceUrl, getMaxCollaborationFileSize, persistCollaborationFile, removeCollaborationFile } from './collaboration.files.js'
import { canSignCollaborationDeal, CollaborationAccessError, transitionCollaborationDeal } from './collaboration.policy.js'
import { decryptPii, decryptReportPii } from './report-pii.js'
import { notifyAdmins, notifyUser, publishNotification } from '../notifications/notifications.service.js'
import { validateCommissionConfig } from './collaboration.commissions.policy.js'
import {
  buildAdminCollaborationDealsWhere,
  buildAdminCollaborationReadyToSignWhere,
  buildAdminSignedContractsWhere,
  buildAdminPendingCommissionsWhere,
  parseAdminCollaborationFilters,
  parseAdminSignedContractsFilters,
} from './collaboration.admin.read-queries.js'

const totpEnrollmentSchema = z.object({ password: z.string().min(1).max(200) }).strict()
const totpVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict()
const decisionSchema = z.object({
  decision: z.enum(['CONFIRM', 'REJECT']),
  reason: z.string().trim().min(10).max(2000).optional(),
  overrideConfirmation: z.boolean().optional(),
}).strict()
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n
const signatureSchema = z.object({
  contractReference: z.string().trim().min(1).max(150),
  contractDate: z.string().datetime(),
  contractAmount: z.string().trim().refine(
    (value) => /^\d{1,19}$/.test(value) && BigInt(value) > 0n && BigInt(value) <= MAX_SIGNED_BIGINT,
    'Saisissez un montant final positif en Ariary.',
  ),
}).strict()
const salesTeamInvitationSchema = z.object({
  email: z.string().trim().email().max(255).transform((email) => email.toLowerCase()),
  role: z.enum(['SALES_REVIEWER', 'SALES_SIGNER']),
}).strict()
const collaborationAssignmentSchema = z.object({
  reviewAssignedToId: z.number().int().positive().nullable().optional(),
  signAssignedToId: z.number().int().positive().nullable().optional(),
}).strict().refine((value) => value.reviewAssignedToId !== undefined || value.signAssignedToId !== undefined)
const ACTIVATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

const contractUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: getMaxCollaborationFileSize(), files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(new Error('Le contrat doit être un fichier PDF, JPEG, PNG ou WebP.'))
      return
    }
    callback(null, true)
  },
}).single('file')

function parseContractUpload(request: Request, response: Response, next: (error?: unknown) => void) {
  contractUpload(request, response, (error: unknown) => {
    if (!error) { next(); return }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({ error: 'Le contrat ne doit pas dépasser 10 Mio.' })
      return
    }
    response.status(400).json({ error: error instanceof Error ? error.message : 'Fichier de contrat invalide.' })
  })
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

function adminId(request: AuthRequest): number {
  if (!request.user || !['ADMIN', 'SUPER_ADMIN', 'SALES_REVIEWER', 'SALES_SIGNER'].includes(request.user.role)) {
    throw new CollaborationAccessError('Accès administrateur requis.', 404)
  }
  return request.user.id
}

function parseId(value: string | string[]): number | null {
  if (typeof value !== 'string') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

function salesTeamActivationUrl(email: string, token: string): string {
  const url = new URL('/', env.adminAppUrl)
  url.searchParams.set('portal', 'admin')
  url.searchParams.set('activationEmail', email)
  url.searchParams.set('activationToken', token)
  return url.toString()
}

function parseAdminPagination(query: Request['query']): { page: number; limit: number } | null {
  const page = query.page === undefined ? 1 : typeof query.page === 'string' && /^\d+$/.test(query.page) ? Number(query.page) : NaN
  const limit = query.limit === undefined ? 50 : typeof query.limit === 'string' && /^\d+$/.test(query.limit) ? Number(query.limit) : NaN
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) return null
  return { page, limit }
}

function requestAudit(request: Request) {
  return { ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null }
}

async function auditAdminRead(
  request: AuthRequest,
  action: string,
  entityType: string,
  metadata: Prisma.InputJsonValue,
) {
  await prisma.$transaction((transaction) => writeCollaborationAudit(transaction, {
    actorId: request.user!.id,
    actorRole: request.user!.role,
    action,
    entityType,
    metadata,
    ...requestAudit(request),
  }))
}

function isWithinRange(value: Date, from?: Date, to?: Date): boolean {
  return (!from || value >= from) && (!to || value <= to)
}

type AdminCollaborationAlert = {
  id: string
  type: 'BYPASS' | 'EXTRACTION' | 'REPEATED_EXPIRATIONS'
  severity: 'HIGH' | 'MEDIUM'
  occurredAt: Date
  agent: { id: number; name: string } | null
  agents?: Array<{ id: number; name: string }>
  dealId: number | null
  count?: number
  message: string
}

function agentName(profile: { firstName: string; lastName: string } | null): string {
  return profile ? `${profile.firstName} ${profile.lastName}`.trim() || 'Agent' : 'Agent'
}

async function countExtractionAlerts(filters: { agentId?: number; from?: Date; to?: Date }): Promise<number> {
  const [eventCount, settingAlerts] = await Promise.all([
    prisma.collaborationAuditLog.count({
      where: {
        action: { in: ['COLLABORATION_CONTACT_ACCESS_BURST_DETECTED', 'COLLABORATION_CONTACT_DAILY_LIMIT_REACHED'] },
        ...(filters.agentId === undefined ? {} : { actorId: filters.agentId }),
        ...(!filters.from && !filters.to ? {} : {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }),
      },
    }),
    prisma.setting.findMany({
      where: {
        key: {
          startsWith: filters.agentId === undefined
            ? 'collaboration_contact_anomaly:'
            : `collaboration_contact_anomaly:${filters.agentId}:`,
        },
      },
      select: { key: true, value: true },
    }),
  ])
  const settingCount = settingAlerts.filter(({ key, value }) => {
    const match = /^collaboration_contact_anomaly:\d+:(?:denied|no-reports):\d{4}-\d{2}-\d{2}$/.exec(key)
    if (!match) throw new Error('Stored collaboration contact alert key is invalid.')
    const createdAt = new Date(value)
    if (Number.isNaN(createdAt.getTime())) throw new Error('Stored collaboration contact alert timestamp is invalid.')
    return isWithinRange(createdAt, filters.from, filters.to)
  }).length
  return eventCount + settingCount
}

async function countRepeatedExpirationAlerts(filters: { agentId?: number; from?: Date; to?: Date }): Promise<number> {
  const entries = await prisma.collaborationDealStatusHistory.findMany({
    where: {
      toStatus: 'EXPIRED',
      ...(filters.agentId === undefined ? {} : {
        deal: { accessRequests: { some: { requesterId: filters.agentId, status: 'APPROVED' } } },
      }),
      ...(!filters.from && !filters.to ? {} : {
        createdAt: {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(filters.to ? { lte: filters.to } : {}),
        },
      }),
    },
    select: {
      deal: {
        select: {
          accessRequests: {
            where: {
              status: 'APPROVED',
              ...(filters.agentId === undefined ? {} : { requesterId: filters.agentId }),
            },
            select: { requesterId: true },
          },
        },
      },
    },
  })
  const expirationsByAgent = new Map<number, number>()
  for (const { deal } of entries) {
    for (const requesterId of new Set(deal.accessRequests.map(({ requesterId }) => requesterId))) {
      expirationsByAgent.set(requesterId, (expirationsByAgent.get(requesterId) ?? 0) + 1)
    }
  }
  return [...expirationsByAgent.values()].filter((count) => count >= 2).length
}

async function getAdminCollaborationAlerts(
  filters: { agentId?: number; from?: Date; to?: Date },
  type?: AdminCollaborationAlert['type'],
): Promise<AdminCollaborationAlert[]> {
  const period = !filters.from && !filters.to
    ? {}
    : { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
  const alerts: AdminCollaborationAlert[] = []
  const includeBypass = type === undefined || type === 'BYPASS'
  const includeExtraction = type === undefined || type === 'EXTRACTION'
  const includeExpirations = type === undefined || type === 'REPEATED_EXPIRATIONS'

  if (includeBypass) {
    const bypasses = await prisma.collaborationAuditLog.findMany({
      where: {
        action: 'COLLABORATION_PERIODIC_CONTACT_BYPASS_DETECTED',
        ...period,
        ...(filters.agentId === undefined ? {} : {
          deal: { is: { OR: [{ supplierId: filters.agentId }, { closerId: filters.agentId }] } },
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        createdAt: true,
        entityId: true,
        deal: {
          select: {
            supplier: { select: { id: true, agentProfile: { select: { firstName: true, lastName: true } } } },
            closer: { select: { id: true, agentProfile: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
    })
    for (const entry of bypasses) {
      const agents = [entry.deal?.supplier, entry.deal?.closer]
        .filter((agent): agent is NonNullable<typeof agent> => agent !== null && agent !== undefined)
        .map((agent) => ({ id: agent.id, name: agentName(agent.agentProfile) }))
      alerts.push({
        id: `bypass:${entry.id}`,
        type: 'BYPASS',
        severity: 'HIGH',
        occurredAt: entry.createdAt,
        agent: filters.agentId === undefined
          ? null
          : agents.find(({ id }) => id === filters.agentId) ?? null,
        agents,
        dealId: entry.entityId,
        message: 'Une correspondance de contournement a été détectée.',
      })
    }
  }

  if (includeExtraction) {
    const [events, settingAlerts] = await Promise.all([
      prisma.collaborationAuditLog.findMany({
        where: {
          action: { in: ['COLLABORATION_CONTACT_ACCESS_BURST_DETECTED', 'COLLABORATION_CONTACT_DAILY_LIMIT_REACHED'] },
          ...(filters.agentId === undefined ? {} : { actorId: filters.agentId }),
          ...period,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          actorId: true,
          createdAt: true,
          entityId: true,
          actor: { select: { agentProfile: { select: { firstName: true, lastName: true } } } },
          action: true,
        },
      }),
      prisma.setting.findMany({
        where: {
          key: {
            startsWith: filters.agentId === undefined
              ? 'collaboration_contact_anomaly:'
              : `collaboration_contact_anomaly:${filters.agentId}:`,
          },
        },
        select: { key: true, value: true },
      }),
    ])
    for (const event of events) {
      alerts.push({
        id: `extraction:${event.id}`,
        type: 'EXTRACTION',
        severity: 'HIGH',
        occurredAt: event.createdAt,
        agent: event.actorId === null ? null : {
          id: event.actorId,
          name: agentName(event.actor?.agentProfile ?? null),
        },
        dealId: event.entityId,
        message: event.action === 'COLLABORATION_CONTACT_ACCESS_BURST_DETECTED'
          ? 'Une rafale de consultations de coordonnées a été détectée.'
          : 'La limite quotidienne de consultations a été atteinte.',
      })
    }
    const parsedSettings: Array<{ agentId: number; occurredAt: Date; kind: 'denied' | 'no-reports' }> = []
    for (const { key, value } of settingAlerts) {
      const match = /^collaboration_contact_anomaly:(\d+):(denied|no-reports):\d{4}-\d{2}-\d{2}$/.exec(key)
      if (!match) throw new Error('Stored collaboration contact alert key is invalid.')
      const occurredAt = new Date(value)
      if (Number.isNaN(occurredAt.getTime())) throw new Error('Stored collaboration contact alert timestamp is invalid.')
      if (!isWithinRange(occurredAt, filters.from, filters.to)) continue
      parsedSettings.push({ agentId: Number(match[1]), occurredAt, kind: match[2] as 'denied' | 'no-reports' })
    }
    const settingAgentIds = [...new Set(parsedSettings.map(({ agentId }) => agentId))]
    const settingAgents = settingAgentIds.length
      ? await prisma.user.findMany({
        where: { id: { in: settingAgentIds } },
        select: { id: true, agentProfile: { select: { firstName: true, lastName: true } } },
      })
      : []
    const settingAgentMap = new Map(settingAgents.map((agent) => [
      agent.id,
      { id: agent.id, name: agentName(agent.agentProfile) },
    ]))
    for (const setting of parsedSettings) {
      alerts.push({
        id: `extraction-setting:${setting.agentId}:${setting.kind}:${setting.occurredAt.toISOString()}`,
        type: 'EXTRACTION',
        severity: 'MEDIUM',
        occurredAt: setting.occurredAt,
        agent: settingAgentMap.get(setting.agentId) ?? { id: setting.agentId, name: 'Agent' },
        dealId: null,
        message: setting.kind === 'denied'
          ? 'Un volume anormal de consultations refusées a été signalé.'
          : 'De nombreux accès ont été accordés sans rapport de clôture.',
      })
    }
  }

  if (includeExpirations) {
    const expirations = await prisma.collaborationDealStatusHistory.findMany({
      where: {
        toStatus: 'EXPIRED',
        ...(filters.agentId === undefined ? {} : {
          deal: { accessRequests: { some: { requesterId: filters.agentId, status: 'APPROVED' } } },
        }),
        ...period,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        createdAt: true,
        dealId: true,
        deal: {
          select: {
            accessRequests: {
              where: {
                status: 'APPROVED',
                ...(filters.agentId === undefined ? {} : { requesterId: filters.agentId }),
              },
              select: {
                requester: { select: { id: true, agentProfile: { select: { firstName: true, lastName: true } } } },
              },
            },
          },
        },
      },
    })
    const byAgent = new Map<number, { name: string; count: number; occurredAt: Date; dealId: number }>()
    for (const expiration of expirations) {
      const requesters = new Map(expiration.deal.accessRequests.map(({ requester }) => [
        requester.id,
        { id: requester.id, name: agentName(requester.agentProfile) },
      ]))
      for (const [agentId, agent] of requesters) {
        const current = byAgent.get(agentId)
        byAgent.set(agentId, {
          name: agent.name,
          count: (current?.count ?? 0) + 1,
          occurredAt: current && current.occurredAt > expiration.createdAt ? current.occurredAt : expiration.createdAt,
          dealId: current?.dealId ?? expiration.dealId,
        })
      }
    }
    for (const [agentId, value] of byAgent) {
      if (value.count < 2) continue
      alerts.push({
        id: `repeated-expirations:${agentId}`,
        type: 'REPEATED_EXPIRATIONS',
        severity: 'MEDIUM',
        occurredAt: value.occurredAt,
        agent: { id: agentId, name: value.name },
        dealId: value.dealId,
        count: value.count,
        message: 'Cet agent a plusieurs accès approuvés arrivés à expiration.',
      })
    }
  }

  return alerts.sort((left, right) =>
    right.occurredAt.getTime() - left.occurredAt.getTime() || right.id.localeCompare(left.id))
}

async function getAgentScore(userId: number) {
  const deals = await prisma.collaborationDeal.findMany({
    where: { OR: [{ supplierId: userId }, { closerId: userId }] },
    select: { status: true },
  })
  const positive = deals.filter(({ status }) => ['CONFIRMED', 'CONTRACT_SIGNED', 'COMMISSIONS_PAID'].includes(status)).length
  const negative = deals.filter(({ status }) => ['LOST', 'REJECTED', 'DISPUTED', 'EXPIRED'].includes(status)).length
  const resolved = positive + negative
  return {
    score: resolved ? Math.round((positive / resolved) * 1000) / 10 : null,
    confirmed: positive,
    unresolvedOrNegative: negative,
    active: deals.length - resolved,
    resolved,
    method: 'confirmed / (confirmed + lost, rejected, disputed or expired), percentage',
  }
}

export const collaborationAdminRouter = Router()

collaborationAdminRouter.get('/team', collaborationRateLimit({ scope: 'admin-collaboration-team', limit: 20, windowMs: 60_000 }), requireAdminTotp, asyncRoute(async (_request, response) => {
  const staff = await prisma.user.findMany({
    where: { role: { in: ['SALES_REVIEWER', 'SALES_SIGNER'] } },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      totpEnabled: true,
      createdAt: true,
      lastActiveAt: true,
      agentProfile: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const staffIds = staff.map(({ id }) => id)
  const [reviewLoads, signLoads] = staffIds.length === 0 ? [[], []] : await Promise.all([
    prisma.collaborationDeal.groupBy({
      by: ['reviewAssignedToId'],
      where: {
        reviewAssignedToId: { in: staffIds },
        status: { in: env.clientConfirmationRequired
          ? ['CONFIRMED_BY_CLIENT', 'CLIENT_CONFIRMED']
          : ['CLOSING_REPORTED', 'CONFIRMED_BY_CLIENT', 'CLIENT_CONFIRMED'] },
        closingReport: { is: { status: 'SUBMITTED' } },
      },
      _count: { _all: true },
    }),
    prisma.collaborationDeal.groupBy({
      by: ['signAssignedToId'],
      where: {
        signAssignedToId: { in: staffIds },
        status: 'CONFIRMED',
        saleNumber: null,
        closingReport: { is: { status: 'SUBMITTED' } },
      },
      _count: { _all: true },
    }),
  ])
  const reviewCounts = new Map(reviewLoads.map((item) => [item.reviewAssignedToId, item._count._all]))
  const signCounts = new Map(signLoads.map((item) => [item.signAssignedToId, item._count._all]))
  response.json({
    data: staff.map(({ agentProfile, ...member }) => ({
      ...member,
      name: agentProfile ? `${agentProfile.firstName} ${agentProfile.lastName}`.trim() || member.email : member.email,
      reviewLoad: reviewCounts.get(member.id) ?? 0,
      signLoad: signCounts.get(member.id) ?? 0,
    })),
  })
}))

collaborationAdminRouter.post('/team/invitations', collaborationRateLimit({ scope: 'admin-collaboration-team-invite', limit: 10, windowMs: 60_000 }), requireAdminTotp, asyncRoute(async (request, response) => {
  const actorId = adminId(request)
  const body = salesTeamInvitationSchema.safeParse(request.body)
  if (!body.success) {
    response.status(400).json({ error: 'Adresse email ou rôle invalide.', details: body.error.flatten() })
    return
  }
  if (!isEmailDeliveryConfigured()) {
    response.status(503).json({ error: 'L’envoi des emails n’est pas configuré. Configurez SMTP avant d’inviter un membre.' })
    return
  }

  const now = new Date()
  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = await bcrypt.hash(rawToken, 12)
  const passwordHash = await bcrypt.hash(randomUUID(), 12)
  let member: { id: number; email: string; role: 'SALES_REVIEWER' | 'SALES_SIGNER'; status: string }
  try {
    member = await prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: {
          email: body.data.email,
          passwordHash,
          role: body.data.role,
          status: 'EN_ATTENTE_ACTIVATION',
        },
        select: { id: true, email: true, role: true, status: true },
      })
      await transaction.activationToken.create({
        data: {
          userId: created.id,
          tokenHash,
          type: 'ACTIVATION',
          expiresAt: new Date(now.getTime() + ACTIVATION_TOKEN_TTL_MS),
        },
      })
      await writeCollaborationAudit(transaction, {
        actorId,
        action: 'SALES_TEAM_INVITATION_CREATED',
        entityType: 'User',
        entityId: created.id,
        metadata: { email: created.email, role: created.role },
        ...requestAudit(request),
        createdAt: now,
      })
      return { ...created, role: body.data.role }
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      response.status(409).json({ error: 'Un compte existe déjà avec cette adresse email.' })
      return
    }
    throw error
  }

  try {
    await sendSalesTeamInvitationEmail(member.email, member.role, salesTeamActivationUrl(member.email, rawToken))
  } catch (error) {
    console.error('Failed to send sales team invitation email:', error)
    await prisma.$transaction((transaction) => writeCollaborationAudit(transaction, {
      actorId,
      action: 'SALES_TEAM_INVITATION_EMAIL_FAILED',
      entityType: 'User',
      entityId: member.id,
      metadata: { role: member.role },
      ...requestAudit(request),
    }))
    response.status(502).json({ error: 'Le compte a été créé, mais l’email n’a pas pu être envoyé. Utilisez « Renvoyer l’invitation ».' })
    return
  }
  response.status(201).json({ data: member })
}))

collaborationAdminRouter.post('/team/:userId/invitation', collaborationRateLimit({ scope: 'admin-collaboration-team-resend', limit: 10, windowMs: 60_000 }), requireAdminTotp, asyncRoute(async (request, response) => {
  const actorId = adminId(request)
  const userId = parseId(request.params.userId)
  if (userId === null) {
    response.status(400).json({ error: 'Identifiant de membre invalide.' })
    return
  }
  if (!isEmailDeliveryConfigured()) {
    response.status(503).json({ error: 'L’envoi des emails n’est pas configuré. Configurez SMTP avant de renvoyer une invitation.' })
    return
  }
  const member = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, status: true },
  })
  if (!member || (member.role !== 'SALES_REVIEWER' && member.role !== 'SALES_SIGNER') || member.status !== 'EN_ATTENTE_ACTIVATION') {
    response.status(404).json({ error: 'Invitation en attente introuvable.' })
    return
  }

  const now = new Date()
  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = await bcrypt.hash(rawToken, 12)
  await prisma.$transaction(async (transaction) => {
    await transaction.activationToken.updateMany({
      where: { userId, type: 'ACTIVATION', usedAt: null },
      data: { usedAt: now },
    })
    await transaction.activationToken.create({
      data: {
        userId,
        tokenHash,
        type: 'ACTIVATION',
        expiresAt: new Date(now.getTime() + ACTIVATION_TOKEN_TTL_MS),
      },
    })
    await writeCollaborationAudit(transaction, {
      actorId,
      action: 'SALES_TEAM_INVITATION_RESENT',
      entityType: 'User',
      entityId: userId,
      metadata: { role: member.role },
      ...requestAudit(request),
      createdAt: now,
    })
  })
  try {
    await sendSalesTeamInvitationEmail(member.email, member.role, salesTeamActivationUrl(member.email, rawToken))
  } catch (error) {
    console.error('Failed to resend sales team invitation email:', error)
    await prisma.$transaction((transaction) => writeCollaborationAudit(transaction, {
      actorId,
      action: 'SALES_TEAM_INVITATION_EMAIL_FAILED',
      entityType: 'User',
      entityId: member.id,
      metadata: { role: member.role, resent: true },
      ...requestAudit(request),
    }))
    response.status(502).json({ error: 'L’email n’a pas pu être envoyé. Vérifiez SMTP puis réessayez.' })
    return
  }
  response.json({ data: { resent: true } })
}))

collaborationAdminRouter.get('/dashboard', collaborationRateLimit({ scope: 'admin-collaboration-dashboard', limit: 20, windowMs: 60_000 }), requireSalesTeamTotp, asyncRoute(async (request, response) => {
  const parsedFilters = parseAdminCollaborationFilters(request.query)
  if (!parsedFilters.filters) {
    response.status(400).json({ error: parsedFilters.error })
    return
  }
  const filters = parsedFilters.filters
  const dealsWhere = buildAdminCollaborationDealsWhere(filters)
  const readyToSignWhere = buildAdminCollaborationReadyToSignWhere(filters)
  const pendingCommissionsWhere = buildAdminPendingCommissionsWhere(filters)
  const dealScope = filters.agentId === undefined
    ? {}
    : { OR: [{ supplierId: filters.agentId }, { closerId: filters.agentId }] }
  const dealUpdatedAt = !filters.from && !filters.to
    ? {}
    : { updatedAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
  const auditPeriod = !filters.from && !filters.to
    ? {}
    : { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
  const isSalesReviewer = request.user?.role === 'SALES_REVIEWER'
  const isSalesSigner = request.user?.role === 'SALES_SIGNER'
  if (isSalesReviewer) {
    dealsWhere.reviewAssignedToId = request.user!.id
    dealsWhere.status = env.clientConfirmationRequired
      ? { in: ['CONFIRMED_BY_CLIENT', 'CLIENT_CONFIRMED'] }
      : { in: ['CLOSING_REPORTED', 'CONFIRMED_BY_CLIENT', 'CLIENT_CONFIRMED'] }
  }
  if (isSalesSigner) readyToSignWhere.signAssignedToId = request.user!.id
  const reviewQueueWhere: Prisma.CollaborationDealWhereInput = {
    ...dealsWhere,
    status: env.clientConfirmationRequired
      ? { in: ['CONFIRMED_BY_CLIENT', 'CLIENT_CONFIRMED'] }
      : { in: ['CLOSING_REPORTED', 'CONFIRMED_BY_CLIENT', 'CLIENT_CONFIRMED'] },
    closingReport: { is: { status: 'SUBMITTED' } },
  }
  const signQueueWhere: Prisma.CollaborationDealWhereInput = {
    ...readyToSignWhere,
    closingReport: { is: { status: 'SUBMITTED' } },
  }
  const now = new Date()
  const reviewSlaCutoff = new Date(now.getTime() - env.collaborationReviewSlaHours * 60 * 60_000)
  const signatureSlaCutoff = new Date(now.getTime() - env.collaborationSignatureSlaHours * 60 * 60_000)
  const reviewOverdueWhere: Prisma.CollaborationDealWhereInput = env.clientConfirmationRequired
    ? { ...reviewQueueWhere, clientConfirmedAt: { lt: reviewSlaCutoff } }
    : {
        ...reviewQueueWhere,
        closingReport: { is: { status: 'SUBMITTED', submittedAt: { lt: reviewSlaCutoff } } },
      }
  const signatureOverdueWhere: Prisma.CollaborationDealWhereInput = {
    ...signQueueWhere,
    AND: [{
      OR: [
        { confirmedAt: { lt: signatureSlaCutoff } },
        { confirmedAt: null, updatedAt: { lt: signatureSlaCutoff } },
      ],
    }],
  }
  const [salesToVerify, contractsToSign, commissionsToPay, disputes, bypassAlerts, extractionAlerts, repeatedExpirations, overrides] = isSalesReviewer
    ? [await prisma.collaborationDeal.count({ where: dealsWhere }), 0, 0, 0, 0, 0, 0, 0]
    : isSalesSigner
      ? [0, await prisma.collaborationDeal.count({ where: readyToSignWhere }), 0, 0, 0, 0, 0, 0]
      : await Promise.all([
        prisma.collaborationDeal.count({ where: dealsWhere }),
        prisma.collaborationDeal.count({ where: readyToSignWhere }),
        prisma.collaborationCommission.count({ where: pendingCommissionsWhere }),
        prisma.collaborationDeal.count({ where: { status: 'DISPUTED', ...dealScope, ...dealUpdatedAt } }),
        prisma.collaborationAuditLog.count({
          where: {
            action: 'COLLABORATION_PERIODIC_CONTACT_BYPASS_DETECTED',
            ...auditPeriod,
            ...(filters.agentId === undefined ? {} : { deal: { is: { OR: [{ supplierId: filters.agentId }, { closerId: filters.agentId }] } } }),
          },
        }),
        countExtractionAlerts(filters),
        countRepeatedExpirationAlerts(filters),
        prisma.collaborationDeal.count({
          where: {
            clientConfirmationOverrideReason: { not: null },
            ...dealScope,
            ...dealUpdatedAt,
          },
        }),
      ])
  const [reviewOverdue, signatureOverdue, unassignedReview, unassignedSignature] = await Promise.all([
    isSalesSigner ? Promise.resolve(0) : prisma.collaborationDeal.count({ where: reviewOverdueWhere }),
    isSalesReviewer ? Promise.resolve(0) : prisma.collaborationDeal.count({ where: signatureOverdueWhere }),
    isSalesReviewer || isSalesSigner
      ? Promise.resolve(0)
      : prisma.collaborationDeal.count({ where: { ...reviewQueueWhere, reviewAssignedToId: null } }),
    isSalesReviewer || isSalesSigner
      ? Promise.resolve(0)
      : prisma.collaborationDeal.count({ where: { ...signQueueWhere, signAssignedToId: null } }),
  ])
  await auditAdminRead(request, 'COLLABORATION_ADMIN_DASHBOARD_VIEWED', 'CollaborationDashboard', {
    agentId: filters.agentId ?? null,
    from: filters.from?.toISOString() ?? null,
    to: filters.to?.toISOString() ?? null,
  })
  response.json({
    data: {
      salesToVerify,
      contractsToSign,
      commissionsToPay,
      disputes,
      bypassAlerts,
      extractionAlerts,
      repeatedExpirations,
      overrides,
      sla: {
        review: {
          targetHours: env.collaborationReviewSlaHours,
          overdue: reviewOverdue,
          unassigned: unassignedReview,
        },
        signature: {
          targetHours: env.collaborationSignatureSlaHours,
          overdue: signatureOverdue,
          unassigned: unassignedSignature,
        },
      },
    },
    filters: {
      agentId: filters.agentId ?? null,
      from: filters.from?.toISOString() ?? null,
      to: filters.to?.toISOString() ?? null,
    },
  })
}))

collaborationAdminRouter.get('/alerts', collaborationRateLimit({ scope: 'admin-collaboration-alerts', limit: 20, windowMs: 60_000 }), requireAdminTotp, asyncRoute(async (request, response) => {
  const parsedFilters = parseAdminCollaborationFilters(request.query)
  const pagination = parseAdminPagination(request.query)
  const requestedType = request.query.type
  const allowedTypes = ['BYPASS', 'EXTRACTION', 'REPEATED_EXPIRATIONS'] as const
  const type = requestedType === undefined
    ? undefined
    : typeof requestedType === 'string' && allowedTypes.includes(requestedType as typeof allowedTypes[number])
      ? requestedType as AdminCollaborationAlert['type']
      : null
  if (!parsedFilters.filters || !pagination || type === null) {
    response.status(400).json({ error: parsedFilters.error ?? 'Filtres ou pagination invalides.' })
    return
  }
  const alerts = await getAdminCollaborationAlerts(parsedFilters.filters, type)
  await auditAdminRead(request, 'COLLABORATION_ADMIN_ALERTS_VIEWED', 'CollaborationAlert', {
    type: type ?? null,
    agentId: parsedFilters.filters.agentId ?? null,
    from: parsedFilters.filters.from?.toISOString() ?? null,
    to: parsedFilters.filters.to?.toISOString() ?? null,
    page: pagination.page,
    limit: pagination.limit,
  })
  response.json({
    data: alerts.slice((pagination.page - 1) * pagination.limit, pagination.page * pagination.limit)
      .map((alert) => ({
        ...alert,
        occurredAt: alert.occurredAt.toISOString(),
      })),
    pagination: { ...pagination, total: alerts.length },
    filters: {
      type: type ?? null,
      agentId: parsedFilters.filters.agentId ?? null,
      from: parsedFilters.filters.from?.toISOString() ?? null,
      to: parsedFilters.filters.to?.toISOString() ?? null,
    },
  })
}))

collaborationAdminRouter.post('/2fa/enroll/start', collaborationRateLimit({ scope: 'admin-totp-enroll-start', limit: 5, windowMs: 15 * 60_000 }), asyncRoute(async (request, response) => {
  const id = adminId(request)
  const body = totpEnrollmentSchema.safeParse(request.body)
  if (!body.success) {
    response.status(400).json({ error: 'Mot de passe invalide.', details: body.error.flatten() })
    return
  }
  const user = await prisma.user.findFirst({
    where: { id, role: { in: ['ADMIN', 'SUPER_ADMIN', 'SALES_REVIEWER', 'SALES_SIGNER'] }, status: 'ACTIF' },
    select: { email: true, passwordHash: true, totpEnabled: true },
  })
  if (!user || !(await bcrypt.compare(body.data.password, user.passwordHash))) {
    response.status(403).json({ error: 'Vérification du mot de passe impossible.' })
    return
  }
  if (user.totpEnabled) {
    response.status(409).json({ error: 'La double authentification est déjà activée.' })
    return
  }
  const enrollment = createTotpEnrollment(user.email)
  const audit = requestAudit(request)
  await prisma.$transaction(async (transaction) => {
    await transaction.user.update({
      where: { id },
      data: { totpSecretCiphertext: encryptTotpSecret(enrollment.secret), totpEnabled: false, totpLastUsedStep: null },
    })
    await writeCollaborationAudit(transaction, {
      actorId: id,
      action: 'ADMIN_TOTP_ENROLLMENT_STARTED',
      entityType: 'User',
      entityId: id,
      metadata: { method: 'TOTP' },
      ...audit,
    })
  })
  response.json({ data: enrollment })
}))

collaborationAdminRouter.post('/2fa/enroll/verify', collaborationRateLimit({ scope: 'admin-totp-enroll-verify', limit: 10, windowMs: 15 * 60_000 }), asyncRoute(async (request, response) => {
  const id = adminId(request)
  const body = totpVerifySchema.safeParse(request.body)
  if (!body.success) {
    response.status(400).json({ error: 'Code TOTP invalide.', details: body.error.flatten() })
    return
  }
  const user = await prisma.user.findFirst({
    where: { id, role: { in: ['ADMIN', 'SUPER_ADMIN', 'SALES_REVIEWER', 'SALES_SIGNER'] }, status: 'ACTIF', totpEnabled: false },
    select: { totpSecretCiphertext: true },
  })
  if (!user?.totpSecretCiphertext) {
    response.status(409).json({ error: 'Démarrez d’abord l’enrôlement TOTP.' })
    return
  }
  const step = verifyTotp(decryptPii(user.totpSecretCiphertext), body.data.code)
  if (step === null) {
    response.status(400).json({ error: 'Code TOTP incorrect ou expiré.' })
    return
  }
  const audit = requestAudit(request)
  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.user.updateMany({
      where: { id, totpEnabled: false },
      data: { totpEnabled: true, totpLastUsedStep: step },
    })
    if (updated.count !== 1) throw new CollaborationAccessError('L’enrôlement TOTP a changé. Rechargez la page.', 409)
    await writeCollaborationAudit(transaction, {
      actorId: id,
      action: 'ADMIN_TOTP_ENABLED',
      entityType: 'User',
      entityId: id,
      metadata: { method: 'TOTP' },
      ...audit,
    })
  })
  response.json({ data: { enabled: true } })
}))

collaborationAdminRouter.get('/trust', collaborationRateLimit({ scope: 'admin-collaboration-trust', limit: 20, windowMs: 60_000 }), requireAdminTotp, asyncRoute(async (_request, response) => {
  const pagination = parseAdminPagination(_request.query)
  if (!pagination) {
    response.status(400).json({ error: 'Pagination invalide.' })
    return
  }
  const where = { role: 'AGENT' as const }
  const [total, agents] = await Promise.all([prisma.user.count({ where }), prisma.user.findMany({
    where: { role: 'AGENT' },
    orderBy: { id: 'asc' },
    skip: (pagination.page - 1) * pagination.limit,
    take: pagination.limit,
    select: {
      id: true,
      status: true,
      agentProfile: { select: { firstName: true, lastName: true } },
      collaborationTrustScoreSnapshots: {
        orderBy: { calculatedAt: 'desc' },
        take: 1,
        select: { score: true, formulaVersion: true, calculatedAt: true },
      },
    },
  })])
  await auditAdminRead(_request, 'COLLABORATION_ADMIN_TRUST_VIEWED', 'AgentTrustScore', {
    page: pagination.page,
    limit: pagination.limit,
  })
  response.json({
    data: agents.map(({ collaborationTrustScoreSnapshots, agentProfile, ...agent }) => {
      const score = collaborationTrustScoreSnapshots[0] ?? null
      return {
        id: agent.id,
        status: agent.status,
        name: agentProfile ? `${agentProfile.firstName} ${agentProfile.lastName}`.trim() || 'Agent' : 'Agent',
        trustScore: score,
        suspensionProposed: score !== null && score.score <= env.collaborationTrustScoreSuspensionProposalThreshold,
      }
    }),
    pagination: { ...pagination, total },
    formulaVersion: 1,
  })
}))

collaborationAdminRouter.get('/agents/active', collaborationRateLimit({ scope: 'admin-collaboration-active-agents', limit: 30, windowMs: 60_000 }), requireAdminTotp, asyncRoute(async (request, response) => {
  const pagination = parseAdminPagination(request.query)
  if (!pagination) {
    response.status(400).json({ error: 'Pagination invalide.' })
    return
  }
  const where = { role: 'AGENT' as const, status: 'ACTIF' as const }
  const [total, agents] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { id: 'asc' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
      select: {
        id: true,
        agentProfile: { select: { firstName: true, lastName: true } },
      },
    }),
  ])
  await auditAdminRead(request, 'COLLABORATION_ADMIN_ACTIVE_AGENTS_VIEWED', 'Agent', {
    page: pagination.page,
    limit: pagination.limit,
  })
  response.json({
    data: agents.map(({ id, agentProfile }) => ({
      id,
      name: agentProfile ? `${agentProfile.firstName} ${agentProfile.lastName}`.trim() || 'Agent' : 'Agent',
    })),
    pagination: { ...pagination, total },
  })
}))

collaborationAdminRouter.get('/deals/overrides', collaborationRateLimit({ scope: 'admin-collaboration-overrides', limit: 30, windowMs: 60_000 }), requireAdminTotp, asyncRoute(async (request, response) => {
  const parsedFilters = parseAdminCollaborationFilters(request.query)
  const pagination = parseAdminPagination(request.query)
  if (!parsedFilters.filters || !pagination) {
    response.status(400).json({ error: parsedFilters.error ?? 'Pagination invalide.' })
    return
  }
  const resolvedAt = parsedFilters.filters.from || parsedFilters.filters.to
    ? {
        ...(parsedFilters.filters.from ? { gte: parsedFilters.filters.from } : {}),
        ...(parsedFilters.filters.to ? { lte: parsedFilters.filters.to } : {}),
      }
    : undefined
  const where: Prisma.CollaborationDealWhereInput = {
    clientConfirmationOverrideReason: { not: null },
    ...(parsedFilters.filters.agentId === undefined ? {} : {
      OR: [{ supplierId: parsedFilters.filters.agentId }, { closerId: parsedFilters.filters.agentId }],
    }),
    ...(resolvedAt ? { resolvedAt } : {}),
  }
  const [total, deals] = await Promise.all([
    prisma.collaborationDeal.count({ where }),
    prisma.collaborationDeal.findMany({
      where,
      orderBy: [{ resolvedAt: 'desc' }, { id: 'desc' }],
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
      select: {
        id: true,
        status: true,
        closingReportedAt: true,
        updatedAt: true,
        clientConfirmationOverrideReason: true,
        resolvedAt: true,
        supplier: { select: { id: true, agentProfile: { select: { firstName: true, lastName: true } } } },
        closer: { select: { id: true, agentProfile: { select: { firstName: true, lastName: true } } } },
        reviewer: { select: { id: true, agentProfile: { select: { firstName: true, lastName: true } } } },
      },
    }),
  ])
  await auditAdminRead(request, 'COLLABORATION_ADMIN_OVERRIDES_VIEWED', 'CollaborationDeal', {
    agentId: parsedFilters.filters.agentId ?? null,
    from: parsedFilters.filters.from?.toISOString() ?? null,
    to: parsedFilters.filters.to?.toISOString() ?? null,
    page: pagination.page,
    limit: pagination.limit,
  })
  response.json({
    data: deals.map((deal) => ({
      id: deal.id,
      status: deal.status,
      closingReportedAt: deal.closingReportedAt,
      updatedAt: deal.updatedAt,
      overrideReason: deal.clientConfirmationOverrideReason,
      overrideAt: deal.resolvedAt,
      admin: deal.reviewer ? {
        id: deal.reviewer.id,
        name: deal.reviewer.agentProfile
          ? `${deal.reviewer.agentProfile.firstName} ${deal.reviewer.agentProfile.lastName}`.trim() || 'Admin'
          : 'Admin',
      } : null,
      supplier: deal.supplier ? {
        id: deal.supplier.id,
        name: deal.supplier.agentProfile ? `${deal.supplier.agentProfile.firstName} ${deal.supplier.agentProfile.lastName}`.trim() || 'Agent' : 'Agent',
      } : null,
      closer: deal.closer ? {
        id: deal.closer.id,
        name: deal.closer.agentProfile ? `${deal.closer.agentProfile.firstName} ${deal.closer.agentProfile.lastName}`.trim() || 'Agent' : 'Agent',
      } : null,
    })),
    pagination: { ...pagination, total },
    filters: {
      agentId: parsedFilters.filters.agentId ?? null,
      from: parsedFilters.filters.from?.toISOString() ?? null,
      to: parsedFilters.filters.to?.toISOString() ?? null,
    },
  })
}))

collaborationAdminRouter.get('/deals', collaborationRateLimit({ scope: 'admin-collaboration-list', limit: 60, windowMs: 60_000 }), requireSalesReviewTotp, asyncRoute(async (request, response) => {
  const parsedFilters = parseAdminCollaborationFilters(request.query)
  const pagination = parseAdminPagination(request.query)
  const requestedStatus = request.query.status
  if (!parsedFilters.filters || !pagination || (requestedStatus !== undefined && requestedStatus !== 'DISPUTED')) {
    response.status(400).json({ error: parsedFilters.error ?? 'Pagination invalide.' })
    return
  }
  if (requestedStatus === 'DISPUTED' && parsedFilters.filters.reviewStage !== undefined) {
    response.status(400).json({ error: 'Le filtre d’étape ne s’applique pas à la file des litiges.' })
    return
  }
  if (request.user?.role === 'SALES_REVIEWER' && requestedStatus === 'DISPUTED') {
    response.status(403).json({ error: 'Cette file est réservée à l’administration.' })
    return
  }
  if (request.user?.role === 'SALES_REVIEWER'
    && parsedFilters.filters.reviewStage !== undefined
    && parsedFilters.filters.reviewStage !== 'CLIENT_CONFIRMED') {
    response.status(403).json({ error: 'Les vérificateurs ne peuvent consulter que les dossiers confirmés par le client.' })
    return
  }
  const isDisputedQueue = requestedStatus === 'DISPUTED' || parsedFilters.filters.reviewStage === 'DISPUTED'
  const where = buildAdminCollaborationDealsWhere(parsedFilters.filters, isDisputedQueue ? 'DISPUTED' : undefined)
  if (parsedFilters.filters.sla === 'OVERDUE') {
    const cutoff = new Date(Date.now() - env.collaborationReviewSlaHours * 60 * 60_000)
    where.closingReport = {
      is: {
        status: 'SUBMITTED',
        ...(!env.clientConfirmationRequired ? { submittedAt: { lt: cutoff } } : {}),
      },
    }
    if (env.clientConfirmationRequired) where.clientConfirmedAt = { lt: cutoff }
  }
  if (request.user?.role === 'SALES_REVIEWER') {
    where.status = env.clientConfirmationRequired
      ? { in: ['CONFIRMED_BY_CLIENT', 'CLIENT_CONFIRMED'] }
      : { in: ['CLOSING_REPORTED', 'CONFIRMED_BY_CLIENT', 'CLIENT_CONFIRMED'] }
    where.reviewAssignedToId = request.user.id
  }
  const [total, deals] = await Promise.all([
    prisma.collaborationDeal.count({ where }),
    prisma.collaborationDeal.findMany({
      where,
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
      select: {
        id: true,
        status: true,
        closingReportedAt: true,
        clientConfirmedAt: true,
        updatedAt: true,
        ...(isDisputedQueue ? {
          disputeReason: true,
          statusHistory: {
            where: { toStatus: 'DISPUTED' },
            orderBy: { createdAt: 'desc' as const },
            take: 1,
            select: { createdAt: true },
          },
        } : {}),
        supplier: { select: { id: true, agentProfile: { select: { firstName: true, lastName: true } } } },
        closer: { select: { id: true, agentProfile: { select: { firstName: true, lastName: true } } } },
        reviewAssignedTo: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
      },
    }),
  ])
  await auditAdminRead(request, 'COLLABORATION_ADMIN_DEALS_VIEWED', 'CollaborationDeal', {
    agentId: parsedFilters.filters.agentId ?? null,
    from: parsedFilters.filters.from?.toISOString() ?? null,
    to: parsedFilters.filters.to?.toISOString() ?? null,
    assignment: parsedFilters.filters.assignment ?? 'ALL',
    reviewStage: parsedFilters.filters.reviewStage ?? 'ALL',
    sla: parsedFilters.filters.sla ?? 'ALL',
    page: pagination.page,
    limit: pagination.limit,
  })
  response.json({
    data: deals.map(({ supplier, closer, statusHistory, disputeReason, reviewAssignedTo, clientConfirmedAt, ...deal }) => ({
      ...deal,
      reviewSlaStartedAt: env.clientConfirmationRequired ? clientConfirmedAt : deal.closingReportedAt,
      ...(isDisputedQueue ? {
        disputeReason: disputeReason?.slice(0, 200) ?? null,
        disputedAt: statusHistory[0]?.createdAt ?? null,
      } : {}),
      supplier: supplier ? { id: supplier.id, name: supplier.agentProfile ? `${supplier.agentProfile.firstName} ${supplier.agentProfile.lastName}`.trim() : 'Agent' } : null,
      closer: closer ? { id: closer.id, name: closer.agentProfile ? `${closer.agentProfile.firstName} ${closer.agentProfile.lastName}`.trim() : 'Agent' } : null,
      reviewAssignedTo: reviewAssignedTo ? {
        id: reviewAssignedTo.id,
        name: reviewAssignedTo.agentProfile ? `${reviewAssignedTo.agentProfile.firstName} ${reviewAssignedTo.agentProfile.lastName}`.trim() || reviewAssignedTo.email : reviewAssignedTo.email,
      } : null,
    })),
    pagination: { ...pagination, total },
    filters: {
      agentId: parsedFilters.filters.agentId ?? null,
      from: parsedFilters.filters.from?.toISOString() ?? null,
      to: parsedFilters.filters.to?.toISOString() ?? null,
      assignment: parsedFilters.filters.assignment ?? 'ALL',
      reviewStage: parsedFilters.filters.reviewStage ?? 'ALL',
      sla: parsedFilters.filters.sla ?? 'ALL',
    },
  })
}))

collaborationAdminRouter.get('/deals/ready-to-sign', collaborationRateLimit({ scope: 'admin-collaboration-ready-to-sign', limit: 30, windowMs: 60_000 }), requireSalesSignatureTotp, asyncRoute(async (request, response) => {
  const parsedFilters = parseAdminCollaborationFilters(request.query)
  const pagination = parseAdminPagination(request.query)
  if (!parsedFilters.filters || !pagination) {
    response.status(400).json({ error: parsedFilters.error ?? 'Pagination invalide.' })
    return
  }
  const where = buildAdminCollaborationReadyToSignWhere(parsedFilters.filters)
  if (parsedFilters.filters.sla === 'OVERDUE') {
    where.closingReport = { is: { status: 'SUBMITTED' } }
    where.confirmedAt = { lt: new Date(Date.now() - env.collaborationSignatureSlaHours * 60 * 60_000) }
  }
  if (request.user?.role === 'SALES_SIGNER') where.signAssignedToId = request.user.id
  const [total, deals] = await Promise.all([
    prisma.collaborationDeal.count({ where }),
    prisma.collaborationDeal.findMany({
      where,
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
      select: {
        id: true,
        status: true,
        updatedAt: true,
        confirmedAt: true,
        contractSignedAt: true,
        saleNumber: true,
        clientConfirmationOverrideReason: true,
        clientConfirmation: { select: { status: true } },
        closingReport: { select: { status: true } },
        signAssignedTo: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
        supplier: { select: { id: true, agentProfile: { select: { firstName: true, lastName: true } } } },
        closer: { select: { id: true, agentProfile: { select: { firstName: true, lastName: true } } } },
      },
    }),
  ])
  await auditAdminRead(request, 'COLLABORATION_ADMIN_READY_TO_SIGN_VIEWED', 'CollaborationDeal', {
    filters: {
      agentId: parsedFilters.filters.agentId ?? null,
      from: parsedFilters.filters.from?.toISOString() ?? null,
      to: parsedFilters.filters.to?.toISOString() ?? null,
      assignment: parsedFilters.filters.assignment ?? 'ALL',
      sla: parsedFilters.filters.sla ?? 'ALL',
    },
    page: pagination.page,
    limit: pagination.limit,
  })
  response.json({
    data: deals.map((deal) => {
      const confirmationStatus = deal.clientConfirmation?.status ?? null
      const confirmationSatisfied = !env.clientConfirmationRequired
        || confirmationStatus === 'CONFIRMED_BY_CLIENT'
        || confirmationStatus === 'CONFIRMED'
        || Boolean(deal.clientConfirmationOverrideReason)
      const closingReportSubmitted = deal.closingReport?.status === 'SUBMITTED'
      const canSign = canSignCollaborationDeal({
        dealStatus: deal.status,
        saleNumber: deal.saleNumber,
        closingReportStatus: deal.closingReport?.status ?? null,
        confirmationRequired: env.clientConfirmationRequired,
        confirmationStatus,
        confirmationOverridden: Boolean(deal.clientConfirmationOverrideReason),
      })
      const blockers = [
        ...(!closingReportSubmitted ? ['CLOSING_REPORT_NOT_SUBMITTED'] : []),
        ...(!confirmationSatisfied ? ['CLIENT_CONFIRMATION_REQUIRED'] : []),
      ]
      return {
        id: deal.id,
        status: deal.status,
        updatedAt: deal.updatedAt,
        confirmedAt: deal.confirmedAt,
        supplier: deal.supplier ? {
          id: deal.supplier.id,
          name: deal.supplier.agentProfile ? `${deal.supplier.agentProfile.firstName} ${deal.supplier.agentProfile.lastName}`.trim() : 'Agent',
        } : null,
        closer: deal.closer ? {
          id: deal.closer.id,
          name: deal.closer.agentProfile ? `${deal.closer.agentProfile.firstName} ${deal.closer.agentProfile.lastName}`.trim() : 'Agent',
        } : null,
        signAssignedTo: deal.signAssignedTo ? {
          id: deal.signAssignedTo.id,
          name: deal.signAssignedTo.agentProfile ? `${deal.signAssignedTo.agentProfile.firstName} ${deal.signAssignedTo.agentProfile.lastName}`.trim() || deal.signAssignedTo.email : deal.signAssignedTo.email,
        } : null,
        prerequisites: { closingReportSubmitted, confirmationSatisfied, canSign, blockers },
      }
    }),
    pagination: { ...pagination, total },
    filters: {
      agentId: parsedFilters.filters.agentId ?? null,
      from: parsedFilters.filters.from?.toISOString() ?? null,
      to: parsedFilters.filters.to?.toISOString() ?? null,
      assignment: parsedFilters.filters.assignment ?? 'ALL',
      sla: parsedFilters.filters.sla ?? 'ALL',
    },
  })
}))

collaborationAdminRouter.get('/contracts/signed', collaborationRateLimit({ scope: 'admin-collaboration-signed-contracts', limit: 30, windowMs: 60_000 }), requireAdminTotp, asyncRoute(async (request, response) => {
  const parsedFilters = parseAdminSignedContractsFilters(request.query)
  const pagination = parseAdminPagination(request.query)
  if (!parsedFilters.filters || !pagination) {
    response.status(400).json({ error: parsedFilters.error ?? 'Pagination invalide.' })
    return
  }
  const where = buildAdminSignedContractsWhere(parsedFilters.filters)
  const [total, deals] = await Promise.all([
    prisma.collaborationDeal.count({ where }),
    prisma.collaborationDeal.findMany({
      where,
      orderBy: [{ contractSignedAt: 'desc' }, { id: 'desc' }],
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
      select: {
        id: true,
        status: true,
        saleNumber: true,
        contractReference: true,
        contractSignedAt: true,
        contractAmount: true,
        supplier: { select: { agentProfile: { select: { firstName: true, lastName: true } } } },
        closer: { select: { agentProfile: { select: { firstName: true, lastName: true } } } },
        report: {
          select: {
            companyName: true,
            contactName: true,
            customServiceDescription: true,
            product: { select: { title: true } },
          },
        },
        closingReport: { select: { saleAmount: true, saleDate: true, details: true } },
        evidence: {
          where: { type: 'CONTRACT' },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            fileSize: true,
            sha256: true,
            createdAt: true,
            storageKey: true,
            uploader: { select: { email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
          },
        },
        auditEntries: {
          where: { action: 'COLLABORATION_CONTRACT_SIGNED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            actor: { select: { email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
    }),
  ])
  await auditAdminRead(request, 'COLLABORATION_ADMIN_SIGNED_CONTRACTS_VIEWED', 'CollaborationDeal', {
    qUsed: Boolean(parsedFilters.filters.q),
    status: parsedFilters.filters.status ?? 'ALL',
    from: parsedFilters.filters.from?.toISOString() ?? null,
    to: parsedFilters.filters.to?.toISOString() ?? null,
    page: pagination.page,
    limit: pagination.limit,
  })
  response.json({
    data: deals.map(({ supplier, closer, report, closingReport, evidence, auditEntries, ...deal }) => {
      const signatureActor = auditEntries[0]?.actor ?? evidence[0]?.uploader ?? null
      const signatory = signatureActor
        ? `${signatureActor.agentProfile?.firstName ?? ''} ${signatureActor.agentProfile?.lastName ?? ''}`.trim() || signatureActor.email
        : null
      return {
        ...deal,
        supplier: supplier.agentProfile
          ? `${supplier.agentProfile.firstName} ${supplier.agentProfile.lastName}`.trim() || 'Agent'
          : 'Agent',
        closer: closer?.agentProfile
          ? `${closer.agentProfile.firstName} ${closer.agentProfile.lastName}`.trim() || 'Agent'
          : null,
        signatory,
        client: { companyName: report.companyName, contactName: report.contactName },
        project: report.product?.title || report.customServiceDescription || 'Projet non renseigné',
        projectDetails: report.customServiceDescription,
        contractAmount: deal.contractAmount?.toString() ?? null,
        reportedAmount: closingReport?.saleAmount?.toString() ?? null,
        saleDate: closingReport?.saleDate,
        closingDetails: closingReport?.details,
        contractFiles: evidence.map((file) => ({
          id: file.id,
          fileName: file.fileName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          sha256: file.sha256,
          createdAt: file.createdAt,
          downloadUrl: createSignedEvidenceUrl(file.id, file.storageKey),
        })),
      }
    }),
    pagination: { ...pagination, total },
    filters: {
      q: parsedFilters.filters.q ?? '',
      status: parsedFilters.filters.status ?? 'ALL',
      from: parsedFilters.filters.from?.toISOString() ?? null,
      to: parsedFilters.filters.to?.toISOString() ?? null,
    },
  })
}))

collaborationAdminRouter.get('/deals/:dealId', collaborationRateLimit({ scope: 'admin-collaboration-detail', limit: 30, windowMs: 60_000 }), requireSalesTeamTotp, asyncRoute(async (request, response) => {
  const dealId = parseId(request.params.dealId)
  if (dealId === null) {
    response.status(400).json({ error: 'Identifiant de dossier invalide.' })
    return
  }
  const deal = await prisma.collaborationDeal.findUnique({
    where: { id: dealId },
    include: {
      report: true,
      secret: true,
      supplier: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true, city: true } } } },
      closer: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true, city: true } } } },
      closingReport: {
        include: {
          supplements: { orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, email: true } } } },
          evidence: { orderBy: { createdAt: 'asc' } },
        },
      },
      clientConfirmation: true,
      reviewAssignedTo: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
      signAssignedTo: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
      evidence: { where: { type: 'CONTRACT' }, orderBy: { createdAt: 'asc' } },
      statusHistory: {
        orderBy: { createdAt: 'asc' },
        include: { actor: { select: { id: true, email: true, role: true } } },
      },
      accessRequests: {
        where: { status: 'APPROVED' },
        select: { requesterId: true, decidedAt: true, status: true },
      },
      hiddenByAgents: {
        orderBy: { hiddenAt: 'asc' },
        select: {
          agentId: true,
          hiddenAt: true,
          agent: { select: { email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
  })
  if (!deal) {
    response.status(404).json({ error: 'Dossier introuvable.' })
    return
  }
  if (request.user?.role === 'SALES_REVIEWER') {
    if (deal.reviewAssignedToId !== request.user.id) {
      response.status(404).json({ error: 'Dossier introuvable.' })
      return
    }
    const clientConfirmed = deal.clientConfirmation?.status === 'CONFIRMED_BY_CLIENT'
      || deal.clientConfirmation?.status === 'CONFIRMED'
    const statusEligible = deal.status === 'CONFIRMED_BY_CLIENT'
      || deal.status === 'CLIENT_CONFIRMED'
      || (!env.clientConfirmationRequired && deal.status === 'CLOSING_REPORTED')
    if (!statusEligible || (env.clientConfirmationRequired && !clientConfirmed)) {
      response.status(404).json({ error: 'Dossier introuvable.' })
      return
    }
  }
  if (request.user?.role === 'SALES_SIGNER'
    && (deal.signAssignedToId !== request.user.id || !['CONFIRMED', 'CONTRACT_SIGNED', 'COMMISSIONS_PAID'].includes(deal.status))) {
    response.status(404).json({ error: 'Dossier introuvable.' })
    return
  }
  const [supplierScore, closerScore] = await Promise.all([
    getAgentScore(deal.supplierId),
    deal.closerId ? getAgentScore(deal.closerId) : Promise.resolve(null),
  ])
  const isFullAdmin = request.user?.role === 'ADMIN' || request.user?.role === 'SUPER_ADMIN'
  const assignmentTeam = isFullAdmin ? await prisma.user.findMany({
    where: { role: { in: ['SALES_REVIEWER', 'SALES_SIGNER'] }, status: 'ACTIF', totpEnabled: true },
    select: { id: true, email: true, role: true, agentProfile: { select: { firstName: true, lastName: true } } },
    orderBy: [{ role: 'asc' }, { id: 'asc' }],
  }) : null
  const { secret, supplier, closer, report, closingReport, evidence, clientConfirmation, hiddenByAgents, reviewAssignedTo, signAssignedTo, ...dealData } = deal
  const {
    contactPhoneHash: _contactPhoneHash,
    contactEmailHash: _contactEmailHash,
    commissionAmount,
    ...decryptedReport
  } = decryptReportPii(report)
  response.json({
    data: {
      ...dealData,
      contractAmount: deal.contractAmount?.toString() ?? null,
      report: {
        ...decryptedReport,
        commissionAmount: commissionAmount?.toString() ?? null,
      },
      prospect: secret ? {
        companyName: decryptPii(secret.companyNameCiphertext),
        contactName: decryptPii(secret.contactNameCiphertext),
        phone: decryptPii(secret.phoneCiphertext),
        email: secret.emailCiphertext ? decryptPii(secret.emailCiphertext) : null,
        address: secret.addressCiphertext ? decryptPii(secret.addressCiphertext) : null,
      } : null,
      supplier: {
        id: supplier.id,
        email: supplier.email,
        profile: supplier.agentProfile,
        score: supplierScore,
      },
      closer: closer ? {
        id: closer.id,
        email: closer.email,
        profile: closer.agentProfile,
        score: closerScore,
      } : null,
      reviewAssignedTo: reviewAssignedTo ? {
        id: reviewAssignedTo.id,
        email: reviewAssignedTo.email,
        name: reviewAssignedTo.agentProfile ? `${reviewAssignedTo.agentProfile.firstName} ${reviewAssignedTo.agentProfile.lastName}`.trim() || reviewAssignedTo.email : reviewAssignedTo.email,
      } : null,
      signAssignedTo: signAssignedTo ? {
        id: signAssignedTo.id,
        email: signAssignedTo.email,
        name: signAssignedTo.agentProfile ? `${signAssignedTo.agentProfile.firstName} ${signAssignedTo.agentProfile.lastName}`.trim() || signAssignedTo.email : signAssignedTo.email,
      } : null,
      assignmentTeam: assignmentTeam ? {
        reviewers: assignmentTeam.filter((member) => member.role === 'SALES_REVIEWER').map(({ id, email, agentProfile }) => ({
          id,
          email,
          name: agentProfile ? `${agentProfile.firstName} ${agentProfile.lastName}`.trim() || email : email,
        })),
        signers: assignmentTeam.filter((member) => member.role === 'SALES_SIGNER').map(({ id, email, agentProfile }) => ({
          id,
          email,
          name: agentProfile ? `${agentProfile.firstName} ${agentProfile.lastName}`.trim() || email : email,
        })),
      } : null,
      assignmentEligibility: {
        review: (deal.status === 'CONFIRMED_BY_CLIENT' || deal.status === 'CLIENT_CONFIRMED'
          || (!env.clientConfirmationRequired && deal.status === 'CLOSING_REPORTED'))
          && closingReport?.status === 'SUBMITTED'
          && (!env.clientConfirmationRequired
            || clientConfirmation?.status === 'CONFIRMED_BY_CLIENT'
            || clientConfirmation?.status === 'CONFIRMED'),
        sign: canSignCollaborationDeal({
          dealStatus: deal.status,
          saleNumber: deal.saleNumber,
          closingReportStatus: closingReport?.status ?? null,
          confirmationRequired: env.clientConfirmationRequired,
          confirmationStatus: clientConfirmation?.status ?? null,
          confirmationOverridden: Boolean(deal.clientConfirmationOverrideReason),
        }),
      },
      closingReport: closingReport ? {
        ...closingReport,
        saleAmount: closingReport.saleAmount?.toString() ?? null,
        evidence: closingReport.evidence.map(({ storageKey, ...closingEvidence }) => ({
          ...closingEvidence,
          downloadUrl: createSignedEvidenceUrl(closingEvidence.id, storageKey),
        })),
      } : null,
      clientConfirmation: clientConfirmation ? {
        id: clientConfirmation.id,
        status: clientConfirmation.status,
        attempts: clientConfirmation.attempts,
        expiresAt: clientConfirmation.expiresAt,
        sentAt: clientConfirmation.sentAt,
        respondedAt: clientConfirmation.respondedAt,
        blockedUntil: clientConfirmation.blockedUntil,
      } : null,
      contractFiles: evidence.map(({ storageKey, ...contractEvidence }) => ({
        ...contractEvidence,
        downloadUrl: createSignedEvidenceUrl(contractEvidence.id, storageKey),
      })),
      hiddenAgents: hiddenByAgents.map(({ agentId, hiddenAt, agent }) => ({
        id: agentId,
        email: agent.email,
        name: agent.agentProfile
          ? `${agent.agentProfile.firstName} ${agent.agentProfile.lastName}`.trim() || agent.email
          : agent.email,
        hiddenAt,
      })),
    },
  })
}))

collaborationAdminRouter.patch('/deals/:dealId/assignment', collaborationRateLimit({ scope: 'admin-collaboration-assignment', limit: 20, windowMs: 60_000 }), requireAdminTotp, asyncRoute(async (request, response) => {
  const actorId = adminId(request)
  const dealId = parseId(request.params.dealId)
  const body = collaborationAssignmentSchema.safeParse(request.body)
  if (dealId === null || !body.success) {
    response.status(400).json({ error: 'Affectation invalide.', details: body.success ? undefined : body.error.flatten() })
    return
  }
  const result = await prisma.$transaction(async (transaction) => {
    const requestedStaffIds = [
      body.data.reviewAssignedToId,
      body.data.signAssignedToId,
    ].filter((id): id is number => id !== undefined && id !== null)
    for (const userId of [...new Set(requestedStaffIds)].sort((left, right) => left - right)) {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
    }
    await transaction.$queryRaw`SELECT id FROM collaboration_deals WHERE id = ${dealId} FOR UPDATE`
    const deal = await transaction.collaborationDeal.findUnique({
      where: { id: dealId },
      include: {
        clientConfirmation: { select: { status: true } },
        closingReport: { select: { status: true } },
      },
    })
    if (!deal) throw new CollaborationAccessError('Dossier introuvable.', 404)

    const data: Prisma.CollaborationDealUpdateInput = {}
    const oldValues: Record<string, number | null> = {}
    const newValues: Record<string, number | null> = {}
    if (body.data.reviewAssignedToId !== undefined) {
      const reviewerEligible = (deal.status === 'CONFIRMED_BY_CLIENT'
        || deal.status === 'CLIENT_CONFIRMED'
        || (!env.clientConfirmationRequired && deal.status === 'CLOSING_REPORTED'))
        && deal.closingReport?.status === 'SUBMITTED'
        && (!env.clientConfirmationRequired
          || deal.clientConfirmation?.status === 'CONFIRMED_BY_CLIENT'
          || deal.clientConfirmation?.status === 'CONFIRMED')
      if (!reviewerEligible) {
        throw new CollaborationAccessError('Ce dossier n’est pas dans la file de vérification.', 409)
      }
      if (body.data.reviewAssignedToId !== null) {
        const reviewer = await transaction.user.findFirst({
          where: { id: body.data.reviewAssignedToId, role: 'SALES_REVIEWER', status: 'ACTIF', totpEnabled: true },
          select: { id: true },
        })
        if (!reviewer) throw new CollaborationAccessError('Le vérificateur doit avoir un compte actif.', 409)
      }
      oldValues.reviewAssignedToId = deal.reviewAssignedToId
      newValues.reviewAssignedToId = body.data.reviewAssignedToId
      data.reviewAssignedTo = body.data.reviewAssignedToId === null
        ? { disconnect: true }
        : { connect: { id: body.data.reviewAssignedToId } }
    }
    if (body.data.signAssignedToId !== undefined) {
      if (!canSignCollaborationDeal({
        dealStatus: deal.status,
        saleNumber: deal.saleNumber,
        closingReportStatus: deal.closingReport?.status ?? null,
        confirmationRequired: env.clientConfirmationRequired,
        confirmationStatus: deal.clientConfirmation?.status ?? null,
        confirmationOverridden: Boolean(deal.clientConfirmationOverrideReason),
      })) {
        throw new CollaborationAccessError('Ce dossier n’est pas prêt pour la signature.', 409)
      }
      if (body.data.signAssignedToId !== null) {
        const signer = await transaction.user.findFirst({
          where: { id: body.data.signAssignedToId, role: 'SALES_SIGNER', status: 'ACTIF', totpEnabled: true },
          select: { id: true },
        })
        if (!signer) throw new CollaborationAccessError('Le signataire doit avoir un compte actif.', 409)
      }
      oldValues.signAssignedToId = deal.signAssignedToId
      newValues.signAssignedToId = body.data.signAssignedToId
      data.signAssignedTo = body.data.signAssignedToId === null
        ? { disconnect: true }
        : { connect: { id: body.data.signAssignedToId } }
    }
    await transaction.collaborationDeal.update({ where: { id: dealId }, data })
    await writeCollaborationAudit(transaction, {
      actorId,
      dealId,
      action: 'COLLABORATION_DEAL_REASSIGNED',
      entityType: 'CollaborationDeal',
      entityId: dealId,
      oldValues,
      newValues,
      ...requestAudit(request),
    })
    return {
      reviewAssignedToId: body.data.reviewAssignedToId !== undefined ? body.data.reviewAssignedToId : deal.reviewAssignedToId,
      signAssignedToId: body.data.signAssignedToId !== undefined ? body.data.signAssignedToId : deal.signAssignedToId,
    }
  })
  response.json({ data: result })
}))

collaborationAdminRouter.patch('/deals/:dealId/hidden-agents/:agentId/restore', collaborationRateLimit({ scope: 'admin-collaboration-restore-hidden', limit: 10, windowMs: 60_000 }), requireAdminTotp, asyncRoute(async (request, response) => {
  const dealId = parseId(request.params.dealId)
  const agentId = parseId(request.params.agentId)
  if (dealId === null || agentId === null) {
    response.status(400).json({ error: 'Identifiant de dossier ou d’agent invalide.' })
    return
  }
  const adminUserId = adminId(request)
  const audit = requestAudit(request)
  await prisma.$transaction(async (transaction) => {
    const deleted = await transaction.collaborationHiddenDeal.deleteMany({ where: { dealId, agentId } })
    if (deleted.count !== 1) throw new CollaborationAccessError('Retrait introuvable.', 404)
    await writeCollaborationAudit(transaction, {
      actorId: adminUserId,
      actorRole: request.user!.role,
      dealId,
      action: 'COLLABORATION_SIGNED_PROSPECT_RESTORED',
      entityType: 'CollaborationHiddenDeal',
      entityId: dealId,
      metadata: { agentId },
      ...audit,
    })
  })
  response.json({ data: { restored: true } })
}))

collaborationAdminRouter.patch('/deals/:dealId/decision', collaborationRateLimit({ scope: 'admin-collaboration-decision', limit: 10, windowMs: 60_000 }), requireSalesReviewTotp, asyncRoute(async (request, response) => {
  const id = adminId(request)
  const dealId = parseId(request.params.dealId)
  const body = decisionSchema.safeParse(request.body)
  if (dealId === null || !body.success) {
    response.status(400).json({ error: 'Décision invalide.', details: body.success ? undefined : body.error.flatten() })
    return
  }
  if (body.data.decision === 'REJECT' && !body.data.reason) {
    response.status(400).json({ error: 'Un motif est obligatoire pour rejeter le dossier.' })
    return
  }
  if (body.data.overrideConfirmation && !body.data.reason) {
    response.status(400).json({ error: 'Un motif est obligatoire pour déroger à la confirmation client.' })
    return
  }
  const audit = requestAudit(request)
  const outcome = await prisma.$transaction(async (transaction) => {
    const deal = await transaction.collaborationDeal.findUnique({
      where: { id: dealId },
      include: { clientConfirmation: true, closingReport: { select: { id: true } } },
    })
    if (!deal || !deal.closingReport) throw new CollaborationAccessError('Dossier ou rapport de clôture introuvable.', 404)
    if (request.user?.role === 'SALES_REVIEWER' && deal.reviewAssignedToId !== id) {
      throw new CollaborationAccessError('Cette vente n’est pas attribuée à votre compte.', 404)
    }
    const confirmedByClient = deal.clientConfirmation?.status === 'CONFIRMED_BY_CLIENT'
      || deal.clientConfirmation?.status === 'CONFIRMED'
    if (request.user?.role === 'SALES_REVIEWER' && !confirmedByClient) {
      throw new CollaborationAccessError('Un vérificateur ne peut pas déroger à l’absence de confirmation client.', 409)
    }
    if (body.data.decision === 'CONFIRM'
      && env.clientConfirmationRequired
      && !confirmedByClient
      && !body.data.overrideConfirmation) {
      throw new CollaborationAccessError('La confirmation client est requise; une dérogation motivée est nécessaire.', 409)
    }
    const target = body.data.decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED'
    await transitionCollaborationDeal(
      transaction,
      { id, role: request.user!.role, status: 'ACTIF' },
      dealId,
      target,
      body.data.reason ?? 'Vérification administrateur.',
      new Date(),
    )
    await transaction.collaborationDeal.update({
      where: { id: dealId },
      data: {
        ...(body.data.decision === 'REJECT' ? { disputeReason: body.data.reason } : {}),
        clientConfirmationOverrideReason: body.data.decision === 'CONFIRM'
          && !confirmedByClient
          && body.data.overrideConfirmation
          ? body.data.reason
          : null,
        reviewedById: id,
        resolvedAt: new Date(),
      },
    })
    await transaction.collaborationClosingReport.update({
      where: { dealId },
      data: {
        reviewedAt: new Date(),
        rejectionReason: body.data.decision === 'REJECT' ? body.data.reason : null,
      },
    })
    await writeCollaborationAudit(transaction, {
      actorId: id,
      dealId,
      action: body.data.decision === 'CONFIRM' ? 'COLLABORATION_ADMIN_CONFIRMED' : 'COLLABORATION_ADMIN_REJECTED',
      entityType: 'CollaborationDeal',
      entityId: dealId,
      metadata: {
        decision: body.data.decision,
        reason: body.data.reason ?? null,
        confirmationOverride: Boolean(body.data.overrideConfirmation && !confirmedByClient),
      },
      ...audit,
    })
    return { status: target, supplierId: deal.supplierId, closerId: deal.closerId }
  })
  if (outcome.status === 'CONFIRMED') {
    try {
      await prisma.$transaction((transaction) =>
        assignCollaborationDealToLeastLoadedStaff(transaction, dealId, 'SALES_SIGNER', new Date()))
    } catch (error) {
      console.error('Failed to auto-assign confirmed collaboration deal; scheduler will retry:', error)
    }
  }
  const recipients = [outcome.supplierId, outcome.closerId].filter((value): value is number => value !== null)
  await Promise.all(recipients.map((userId) => notifyUser(userId, {
    type: 'COLLABORATION_ADMIN_DECISION',
    title: outcome.status === 'CONFIRMED' ? 'Clôture validée' : 'Clôture rejetée',
    body: outcome.status === 'CONFIRMED' ? 'L’administration a validé le rapport de clôture.' : 'L’administration a rejeté le rapport de clôture.',
    link: `/collaboration/${dealId}/timeline`,
    actorId: request.user!.id,
  })))
  response.json({ data: { status: outcome.status } })
}))

collaborationAdminRouter.post('/deals/:dealId/signature', collaborationRateLimit({ scope: 'admin-collaboration-signature', limit: 5, windowMs: 60_000 }), requireSalesSignatureTotp, parseContractUpload, asyncRoute(async (request, response) => {
  const actorId = adminId(request)
  const dealId = parseId(request.params.dealId)
  const body = signatureSchema.safeParse(request.body)
  const file = request.file
  if (dealId === null || !body.success || !file) {
    response.status(400).json({ error: 'Dossier, référence, date, montant final et fichier du contrat sont obligatoires.', details: body.success ? undefined : body.error.flatten() })
    return
  }
  const signedAt = new Date(body.data.contractDate)
  if (signedAt.getTime() > Date.now() + 5 * 60_000) {
    response.status(400).json({ error: 'La date de signature ne peut pas être dans le futur.' })
    return
  }
  const commissionConfig = validateCommissionConfig({
    providerAmount: env.commissionProviderAmount,
    closerAmount: env.commissionCloserAmount,
    currency: env.commissionCurrency,
  })
  const persisted = await persistCollaborationFile(file)
  const audit = requestAudit(request)
  try {
    const outcome = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM collaboration_deals WHERE id = ${dealId} FOR UPDATE`
      const deal = await transaction.collaborationDeal.findUnique({
        where: { id: dealId },
        include: {
          secret: true,
          clientConfirmation: true,
          closingReport: { select: { id: true, status: true } },
        },
      })
      if (!deal || !canSignCollaborationDeal({
        dealStatus: deal.status,
        saleNumber: deal.saleNumber,
        closingReportStatus: deal.closingReport?.status ?? null,
        confirmationRequired: env.clientConfirmationRequired,
        confirmationStatus: deal.clientConfirmation?.status ?? null,
        confirmationOverridden: Boolean(deal.clientConfirmationOverrideReason),
      })) {
        throw new CollaborationAccessError('La signature requiert un dossier confirmé, sans signature précédente et avec un rapport soumis.', 409)
      }
      if (request.user?.role === 'SALES_SIGNER' && deal.signAssignedToId !== actorId) {
        throw new CollaborationAccessError('Cette vente n’est pas attribuée à votre compte.', 404)
      }
      if (!deal.secret) throw new CollaborationAccessError('Coordonnées de prospect introuvables.', 409)
      const matches = await transaction.collaborationProspectSecret.findMany({
        where: {
          dealId: { not: dealId },
          OR: [
            { phoneHash: deal.secret.phoneHash },
            ...(deal.secret.emailHash ? [{ emailHash: deal.secret.emailHash }] : []),
          ],
          deal: {
            is: {
              accessGrantedAt: { not: null },
              closerId: { not: null },
              accessRequests: { some: { status: 'APPROVED' } },
              OR: [
                { closingReport: null },
                { closingReport: { is: { status: 'DRAFT' } } },
              ],
            },
          },
        },
        select: { dealId: true },
      })
      if (matches.length) {
        await transitionCollaborationDeal(
          transaction,
          { role: 'SYSTEM' },
          dealId,
          'DISPUTED',
          'Correspondance de coordonnées avec un autre prospect partagé sans rapport de clôture.',
          new Date(),
        )
        await transaction.collaborationDeal.update({
          where: { id: dealId },
          data: { disputeReason: 'Correspondance de téléphone ou email avec un autre prospect partagé sans rapport de clôture.' },
        })
        await writeCollaborationAudit(transaction, {
          actorId,
          dealId,
          action: 'COLLABORATION_SIGNATURE_HASH_MATCH_DISPUTED',
          entityType: 'CollaborationDeal',
          entityId: dealId,
          metadata: { matchedDealIds: matches.map(({ dealId: matchedId }) => matchedId) },
          ...audit,
        })
        return { duplicateMatch: true as const }
      }
      const counter = await transaction.collaborationSaleCounter.update({
        where: { id: 1 },
        data: { lastValue: { increment: 1 } },
      })
      const key = Buffer.from(env.collaborationEncryptionKey, 'base64')
      if (key.length !== 32) throw new Error('COLLABORATION_ENCRYPTION_KEY is required to generate sale numbers.')
      const opaqueSequence = createHmac('sha256', key)
        .update(`sale:${counter.lastValue.toString()}`)
        .digest('hex')
        .slice(0, 20)
        .toUpperCase()
      const saleNumber = `TSN-${signedAt.getUTCFullYear()}-${opaqueSequence}`
      const pendingRequests = await transaction.collaborationAccessRequest.findMany({
        where: { dealId, status: 'PENDING' },
        select: { id: true, requesterId: true },
      })
      const decisionAt = new Date()
      await transitionCollaborationDeal(
        transaction,
        { id: actorId, role: request.user!.role, status: 'ACTIF' },
        dealId,
        'CONTRACT_SIGNED',
        'Contrat signé et enregistré par l’administration.',
        decisionAt,
      )
      const closedRequests = await transaction.collaborationAccessRequest.updateMany({
        where: { dealId, status: 'PENDING' },
        data: {
          status: 'CLOSED_SIGNED',
          pendingKey: null,
          decidedAt: decisionAt,
          decidedById: actorId,
        },
      })
      if (closedRequests.count !== pendingRequests.length) {
        throw new CollaborationAccessError('Les demandes d’accès ont changé pendant la signature. Réessayez.', 409)
      }
      await transaction.collaborationEmailJob.updateMany({
        where: {
          dealId,
          type: {
            in: [
              'ACCESS_REQUESTED',
              'ACCESS_REQUEST_REMINDER',
              'ACCESS_REQUEST_EXPIRED',
              'ACCESS_REQUEST_REJECTED',
              'ACCESS_REQUEST_NOT_SELECTED',
              'ACCESS_GRANTED',
              'ACCESS_EXPIRED',
            ],
          },
          status: { in: ['QUEUED', 'SENDING'] },
        },
        data: { status: 'CANCELLED', lockedAt: null },
      })
      const requesterIds = [...new Set(pendingRequests
        .map(({ requesterId }) => requesterId)
        .filter((userId) => userId !== deal.supplierId && userId !== deal.closerId))]
      const notifications = await Promise.all(requesterIds.map((userId) =>
        transaction.notification.create({
          data: {
            userId,
            type: 'COLLABORATION_DEAL_CLOSED_SIGNED',
            title: 'Prospect clôturé',
            body: 'Ce prospect est clôturé : contrat signé',
            link: '/collaboration/prospects',
          },
        }),
      ))
      await transaction.collaborationDeal.update({
        where: { id: dealId },
        data: {
          saleNumber,
          contractAmount: BigInt(body.data.contractAmount),
          contractReference: body.data.contractReference,
          contractSignedAt: signedAt,
          contractFileSha256: persisted.sha256,
        },
      })
      const evidence = await transaction.collaborationEvidence.create({
        data: { dealId, uploadedById: actorId, type: 'CONTRACT', ...persisted },
      })
      await transaction.collaborationDomainEvent.create({
        data: {
          dealId,
          eventType: 'contract.signed',
          idempotencyKey: `contract.signed:${dealId}`,
          payload: {
            dealId,
            saleNumber,
            contractAmount: body.data.contractAmount,
            contractReference: body.data.contractReference,
            signedAt: signedAt.toISOString(),
            commissionConfig: {
              providerAmount: commissionConfig.providerAmount.toString(),
              closerAmount: commissionConfig.closerAmount.toString(),
              currency: commissionConfig.currency,
            },
          },
        },
      })
      await writeCollaborationAudit(transaction, {
        actorId,
        dealId,
        action: 'COLLABORATION_CONTRACT_SIGNED',
        entityType: 'CollaborationDeal',
        entityId: dealId,
        metadata: {
          saleNumber,
          contractAmount: body.data.contractAmount,
          contractReference: body.data.contractReference,
          signedAt: signedAt.toISOString(),
          fileSha256: persisted.sha256,
        },
        ...audit,
      })
      return { duplicateMatch: false as const, saleNumber, evidenceId: evidence.id, notifications }
    })
    if (outcome.duplicateMatch) {
      await notifyAdmins({
        type: 'COLLABORATION_DUPLICATE_CONTACT_MATCH',
        title: 'Correspondance de coordonnées détectée',
        body: 'La signature est suspendue : un contact correspond à un autre prospect partagé sans rapport de clôture.',
        link: `/admin/collaboration/${dealId}`,
      })
      await removeCollaborationFile(persisted.storageKey)
      response.status(409).json({ error: 'Correspondance détectée; le dossier est passé en litige et l’administration a été alertée.' })
      return
    }
    outcome.notifications.forEach((notification) => publishNotification(notification))
    response.status(201).json({
      data: {
        status: 'CONTRACT_SIGNED',
        saleNumber: outcome.saleNumber,
        contractAmount: body.data.contractAmount,
        evidenceId: outcome.evidenceId,
      },
    })
  } catch (error) {
    await removeCollaborationFile(persisted.storageKey).catch((cleanupError: unknown) => {
      console.error('Failed to remove unattached contract file:', cleanupError)
    })
    throw error
  }
}))

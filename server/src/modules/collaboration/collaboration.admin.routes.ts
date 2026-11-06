import { createHmac } from 'node:crypto'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import { Router } from 'express'
import type { Request, RequestHandler, Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { env } from '../../config/env.js'
import { prisma } from '../../lib/prisma.js'
import type { AuthRequest } from '../auth/auth.middleware.js'
import { requireAdminTotp, createTotpEnrollment, encryptTotpSecret, verifyTotp } from './admin-totp.js'
import { writeCollaborationAudit } from './collaboration.audit.js'
import { collaborationRateLimit } from './collaboration.rate-limit.js'
import { createSignedEvidenceUrl, getMaxCollaborationFileSize, persistCollaborationFile, removeCollaborationFile } from './collaboration.files.js'
import { canSignCollaborationDeal, CollaborationAccessError, transitionCollaborationDeal } from './collaboration.policy.js'
import { decryptPii, decryptReportPii } from './report-pii.js'
import { notifyAdmins, notifyUser, publishNotification } from '../notifications/notifications.service.js'
import { validateCommissionConfig } from './collaboration.commissions.policy.js'
import {
  buildAdminCollaborationDealsWhere,
  buildAdminCollaborationReadyToSignWhere,
  buildAdminPendingCommissionsWhere,
  parseAdminCollaborationFilters,
} from './collaboration.admin.read-queries.js'

const totpEnrollmentSchema = z.object({ password: z.string().min(1).max(200) }).strict()
const totpVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict()
const decisionSchema = z.object({
  decision: z.enum(['CONFIRM', 'REJECT']),
  reason: z.string().trim().min(10).max(2000).optional(),
  overrideConfirmation: z.boolean().optional(),
}).strict()
const signatureSchema = z.object({
  contractReference: z.string().trim().min(1).max(150),
  contractDate: z.string().datetime(),
}).strict()

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
  if (!request.user || !['ADMIN', 'SUPER_ADMIN'].includes(request.user.role)) {
    throw new CollaborationAccessError('Accès administrateur requis.', 404)
  }
  return request.user.id
}

function parseId(value: string | string[]): number | null {
  if (typeof value !== 'string') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
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

collaborationAdminRouter.get('/dashboard', collaborationRateLimit({ scope: 'admin-collaboration-dashboard', limit: 20, windowMs: 60_000 }), requireAdminTotp, asyncRoute(async (request, response) => {
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
  const [salesToVerify, contractsToSign, commissionsToPay, disputes, bypassAlerts, extractionAlerts, repeatedExpirations, overrides] = await Promise.all([
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
    where: { id, role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIF' },
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
    where: { id, role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIF', totpEnabled: false },
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

collaborationAdminRouter.get('/deals', collaborationRateLimit({ scope: 'admin-collaboration-list', limit: 60, windowMs: 60_000 }), requireAdminTotp, asyncRoute(async (request, response) => {
  const parsedFilters = parseAdminCollaborationFilters(request.query)
  const pagination = parseAdminPagination(request.query)
  const requestedStatus = request.query.status
  if (!parsedFilters.filters || !pagination || (requestedStatus !== undefined && requestedStatus !== 'DISPUTED')) {
    response.status(400).json({ error: parsedFilters.error ?? 'Pagination invalide.' })
    return
  }
  const where = buildAdminCollaborationDealsWhere(parsedFilters.filters, requestedStatus === 'DISPUTED' ? 'DISPUTED' : undefined)
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
        updatedAt: true,
        ...(requestedStatus === 'DISPUTED' ? {
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
      },
    }),
  ])
  await auditAdminRead(request, 'COLLABORATION_ADMIN_DEALS_VIEWED', 'CollaborationDeal', {
    agentId: parsedFilters.filters.agentId ?? null,
    from: parsedFilters.filters.from?.toISOString() ?? null,
    to: parsedFilters.filters.to?.toISOString() ?? null,
    page: pagination.page,
    limit: pagination.limit,
  })
  response.json({
    data: deals.map(({ supplier, closer, statusHistory, disputeReason, ...deal }) => ({
      ...deal,
      ...(requestedStatus === 'DISPUTED' ? {
        disputeReason: disputeReason?.slice(0, 200) ?? null,
        disputedAt: statusHistory[0]?.createdAt ?? null,
      } : {}),
      supplier: supplier ? { id: supplier.id, name: supplier.agentProfile ? `${supplier.agentProfile.firstName} ${supplier.agentProfile.lastName}`.trim() : 'Agent' } : null,
      closer: closer ? { id: closer.id, name: closer.agentProfile ? `${closer.agentProfile.firstName} ${closer.agentProfile.lastName}`.trim() : 'Agent' } : null,
    })),
    pagination: { ...pagination, total },
    filters: {
      agentId: parsedFilters.filters.agentId ?? null,
      from: parsedFilters.filters.from?.toISOString() ?? null,
      to: parsedFilters.filters.to?.toISOString() ?? null,
    },
  })
}))

collaborationAdminRouter.get('/deals/ready-to-sign', collaborationRateLimit({ scope: 'admin-collaboration-ready-to-sign', limit: 30, windowMs: 60_000 }), requireAdminTotp, asyncRoute(async (request, response) => {
  const parsedFilters = parseAdminCollaborationFilters(request.query)
  const pagination = parseAdminPagination(request.query)
  if (!parsedFilters.filters || !pagination) {
    response.status(400).json({ error: parsedFilters.error ?? 'Pagination invalide.' })
    return
  }
  const where = buildAdminCollaborationReadyToSignWhere(parsedFilters.filters)
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
        prerequisites: { closingReportSubmitted, confirmationSatisfied, canSign, blockers },
      }
    }),
    pagination: { ...pagination, total },
    filters: {
      agentId: parsedFilters.filters.agentId ?? null,
      from: parsedFilters.filters.from?.toISOString() ?? null,
      to: parsedFilters.filters.to?.toISOString() ?? null,
    },
  })
}))

collaborationAdminRouter.get('/deals/:dealId', collaborationRateLimit({ scope: 'admin-collaboration-detail', limit: 30, windowMs: 60_000 }), requireAdminTotp, asyncRoute(async (request, response) => {
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
  const [supplierScore, closerScore] = await Promise.all([
    getAgentScore(deal.supplierId),
    deal.closerId ? getAgentScore(deal.closerId) : Promise.resolve(null),
  ])
  const { secret, supplier, closer, report, closingReport, evidence, clientConfirmation, hiddenByAgents, ...dealData } = deal
  const {
    contactPhoneHash: _contactPhoneHash,
    contactEmailHash: _contactEmailHash,
    commissionAmount,
    ...decryptedReport
  } = decryptReportPii(report)
  response.json({
    data: {
      ...dealData,
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

collaborationAdminRouter.patch('/deals/:dealId/decision', collaborationRateLimit({ scope: 'admin-collaboration-decision', limit: 10, windowMs: 60_000 }), requireAdminTotp, asyncRoute(async (request, response) => {
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
    const confirmedByClient = deal.clientConfirmation?.status === 'CONFIRMED_BY_CLIENT'
      || deal.clientConfirmation?.status === 'CONFIRMED'
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

collaborationAdminRouter.post('/deals/:dealId/signature', collaborationRateLimit({ scope: 'admin-collaboration-signature', limit: 5, windowMs: 60_000 }), requireAdminTotp, parseContractUpload, asyncRoute(async (request, response) => {
  const actorId = adminId(request)
  const dealId = parseId(request.params.dealId)
  const body = signatureSchema.safeParse(request.body)
  const file = request.file
  if (dealId === null || !body.success || !file) {
    response.status(400).json({ error: 'Dossier, référence, date et fichier du contrat sont obligatoires.', details: body.success ? undefined : body.error.flatten() })
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
        metadata: { saleNumber, contractReference: body.data.contractReference, signedAt: signedAt.toISOString(), fileSha256: persisted.sha256 },
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
    response.status(201).json({ data: { status: 'CONTRACT_SIGNED', saleNumber: outcome.saleNumber, evidenceId: outcome.evidenceId } })
  } catch (error) {
    await removeCollaborationFile(persisted.storageKey).catch((cleanupError: unknown) => {
      console.error('Failed to remove unattached contract file:', cleanupError)
    })
    throw error
  }
}))

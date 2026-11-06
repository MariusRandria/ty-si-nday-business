import { Router } from 'express'
import type { Request, RequestHandler, Response } from 'express'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import type { AuthRequest } from '../auth/auth.middleware.js'
import { requireAdminTotp } from './admin-totp.js'
import { writeCollaborationAudit } from './collaboration.audit.js'
import { collaborationRateLimit } from './collaboration.rate-limit.js'
import { getLatestAuditChainVerificationStatus } from './collaboration.audit-verification.js'

function asyncRoute(handler: (request: AuthRequest, response: Response) => Promise<void>): RequestHandler {
  return (request, response, next) => {
    void handler(request as AuthRequest, response).catch(next)
  }
}

function queryInteger(value: unknown, min: number, max: number): number | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
}

function queryDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function filters(request: Request, response: Response): Prisma.CollaborationAuditLogWhereInput | null {
  const actorId = queryInteger(request.query.actorId, 1, Number.MAX_SAFE_INTEGER)
  const entityId = queryInteger(request.query.entityId, 1, Number.MAX_SAFE_INTEGER)
  const from = queryDate(request.query.from)
  const to = queryDate(request.query.to)
  if (actorId === null || entityId === null || from === null || to === null || (from && to && from > to)) {
    response.status(400).json({ error: 'Filtres d’audit invalides.' })
    return null
  }
  const action = typeof request.query.action === 'string' ? request.query.action.trim() : undefined
  const entityType = typeof request.query.entityType === 'string' ? request.query.entityType.trim() : undefined
  if ((action && action.length > 100) || (entityType && entityType.length > 80)) {
    response.status(400).json({ error: 'Filtre d’audit trop long.' })
    return null
  }
  return {
    ...(actorId === undefined ? {} : { actorId }),
    ...(entityId === undefined ? {} : { entityId }),
    ...(action ? { action } : {}),
    ...(entityType ? { entityType } : {}),
    ...(!from && !to ? {} : { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }),
  }
}

const router = Router()
const adminAuditRateLimit = (scope: string, limit: number) => collaborationRateLimit({ scope, limit, windowMs: 60_000 })

router.get('/', adminAuditRateLimit('admin-audit-list', 30), requireAdminTotp, asyncRoute(async (request, response) => {
  const where = filters(request, response)
  if (!where) return
  const page = queryInteger(request.query.page, 1, 1_000_000) ?? 1
  const limit = queryInteger(request.query.limit, 1, 100) ?? 50
  if (page === null || limit === null) {
    response.status(400).json({ error: 'Pagination invalide.' })
    return
  }
  const [total, entries, head] = await Promise.all([
    prisma.collaborationAuditLog.count({ where }),
    prisma.collaborationAuditLog.findMany({
      where,
      orderBy: { sequence: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { actor: { select: { email: true } } },
    }),
    prisma.collaborationAuditHead.findUnique({ where: { id: 1 }, select: { sequence: true } }),
  ])
  await prisma.$transaction((transaction) => writeCollaborationAudit(transaction, {
    actorId: request.user!.id,
    actorRole: request.user!.role,
    action: 'COLLABORATION_AUDIT_VIEWED',
    entityType: 'CollaborationAuditLog',
    metadata: { filters: where as Prisma.InputJsonValue, page, limit },
    ip: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
  }))
  response.json({
    data: entries.map(({ actor, ...entry }) => ({ ...entry, actorEmail: actor?.email ?? null })),
    pagination: { page, limit, total },
    chainSequence: head?.sequence.toString() ?? '0',
  })
}))

router.get('/export.csv', adminAuditRateLimit('admin-audit-export', 5), requireAdminTotp, asyncRoute(async (request, response) => {
  const where = filters(request, response)
  if (!where) return
  const count = await prisma.collaborationAuditLog.count({ where })
  if (count > 10_000) {
    response.status(413).json({ error: 'Export trop volumineux. Réduisez la période ou ajoutez un filtre.' })
    return
  }
  const entries = await prisma.collaborationAuditLog.findMany({
    where,
    orderBy: { sequence: 'asc' },
    include: { actor: { select: { email: true } } },
  })
  await prisma.$transaction((transaction) => writeCollaborationAudit(transaction, {
    actorId: request.user!.id,
    actorRole: request.user!.role,
    action: 'COLLABORATION_AUDIT_EXPORTED',
    entityType: 'CollaborationAuditLog',
    metadata: { filters: where as Prisma.InputJsonValue, count },
    ip: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
  }))
  const rows = [
    ['sequence', 'occurredAtUtc', 'occurredAtAntananarivo', 'actorId', 'actorRole', 'actorEmail', 'action', 'entityType', 'entityId', 'dealId', 'oldValues', 'newValues', 'metadata', 'ip', 'userAgent', 'previousHash', 'entryHash'],
    ...entries.map((entry) => [
      entry.sequence.toString(),
      entry.createdAt.toISOString(),
      entry.occurredAtLocal,
      entry.actorId,
      entry.actorRole,
      entry.actor?.email,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.dealId,
      JSON.stringify(entry.oldValues),
      JSON.stringify(entry.newValues),
      JSON.stringify(entry.metadata),
      entry.ip,
      entry.userAgent,
      entry.previousHash,
      entry.entryHash,
    ]),
  ].map((row) => row.map(csvCell).join(',')).join('\r\n')
  response.setHeader('Content-Type', 'text/csv; charset=utf-8')
  response.setHeader('Content-Disposition', 'attachment; filename="collaboration-audit.csv"')
  response.setHeader('Cache-Control', 'private, no-store')
  response.send(`\uFEFF${rows}`)
}))

router.get('/verification', adminAuditRateLimit('admin-audit-verification', 10), requireAdminTotp, asyncRoute(async (request, response) => {
  const status = await getLatestAuditChainVerificationStatus()
  await prisma.$transaction((transaction) => writeCollaborationAudit(transaction, {
    actorId: request.user!.id,
    actorRole: request.user!.role,
    action: 'COLLABORATION_AUDIT_VERIFICATION_STATUS_VIEWED',
    entityType: 'CollaborationAuditChain',
    metadata: { status: status.status, checkedAt: status.checkedAt },
    ip: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
  }))
  response.json({ data: status })
}))

export const collaborationAuditAdminRouter = router

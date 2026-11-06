import multer from 'multer'
import { Router } from 'express'
import type { Request, RequestHandler, Response } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { prisma } from '../../lib/prisma.js'
import type { AuthRequest, AuthUser } from '../auth/auth.middleware.js'
import { notifyAdmins, notifyUser, publishNotification } from '../notifications/notifications.service.js'
import { CollaborationAccessError, canDeclareCollaborationLost, canSubmitCollaborationClosing, findCollaborationDealForActor, transitionCollaborationDeal } from './collaboration.policy.js'
import { writeCollaborationAudit } from './collaboration.audit.js'
import { createAvailabilityNotifications } from './collaboration.notifications.js'
import { collaborationRateLimit } from './collaboration.rate-limit.js'
import { enqueueCollaborationEmail } from './collaboration.outbox.js'
import { compareClientConfirmationTokenHashes, createClientConfirmationCode, createClientConfirmationPublicToken, createSignedEvidenceUrl, getMaxCollaborationFileSize, hashClientConfirmationCode, hashClientConfirmationPublicToken, isClientConfirmationPublicToken, isValidSignedEvidenceUrl, persistCollaborationFile, removeCollaborationFile, sendSignedEvidence } from './collaboration.files.js'
import { decryptPii, encryptPii } from './report-pii.js'
import { assessClientConfirmationAttempt } from './client-confirmation.guard.js'
import { serializeSupplierCollaborationTimeline } from './collaboration.timeline.js'
import { holdPendingCommissionsForDeal } from './collaboration.commissions.service.js'

const draftSchema = z.object({
  saleAmount: z.number().int().positive().safe().nullable().optional(),
  saleDate: z.string().datetime().nullable().optional(),
  details: z.string().trim().min(1).max(10_000).nullable().optional(),
}).strict()

const submitSchema = z.object({
  idempotencyKey: z.string().uuid(),
}).strict()

const lostSchema = z.object({
  reason: z.enum(['NO_INTEREST', 'UNREACHABLE', 'NO_BUDGET', 'COMPETITOR_SELECTED', 'CLIENT_CANCELLED', 'DUPLICATE', 'OTHER']),
}).strict()

const disputeSchema = z.object({
  reason: z.string().trim().min(10).max(2000),
}).strict()

const supplementSchema = z.object({
  details: z.string().trim().min(10).max(10_000),
}).strict()

const confirmationSchema = z.object({
  code: z.string().regex(/^\d{8}$/),
  answer: z.enum(['CONFIRMED', 'DENIED']),
}).strict()

const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: getMaxCollaborationFileSize(), files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(new Error('Seuls les fichiers PDF, JPEG, PNG ou WebP sont acceptés.'))
      return
    }
    callback(null, true)
  },
}).single('file')

function parseUpload(request: Request, response: Response, next: (error?: unknown) => void) {
  evidenceUpload(request, response, (error: unknown) => {
    if (!error) { next(); return }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({ error: 'Le fichier ne doit pas dépasser 10 Mio.' })
      return
    }
    response.status(400).json({ error: error instanceof Error ? error.message : 'Fichier invalide.' })
  })
}

type ActiveActor = AuthUser & { email: string }

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

async function loadAgent(request: AuthRequest, response: Response): Promise<ActiveActor | null> {
  if (!request.user) {
    response.status(401).json({ error: 'Authentification requise.' })
    return null
  }
  const user = await prisma.user.findUnique({
    where: { id: request.user.id },
    select: { id: true, role: true, status: true, email: true },
  })
  if (!user || user.role !== 'AGENT' || user.status !== 'ACTIF') {
    response.status(403).json({ error: 'Un compte agent actif est requis.' })
    return null
  }
  return user
}

function parseId(value: string | string[]): number | null {
  if (typeof value !== 'string') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function requestAudit(request: Request) {
  return { ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null }
}

function closingPermission(actor: ActiveActor, deal: Parameters<typeof canSubmitCollaborationClosing>[1], now = new Date()): boolean {
  return actor.role === 'AGENT' && actor.status === 'ACTIF' && canSubmitCollaborationClosing(actor, deal, now)
}

function assertNotSigned(status: string) {
  if (status === 'CONTRACT_SIGNED' || status === 'COMMISSIONS_PAID') {
    throw new CollaborationAccessError('Prospect déjà signé', 409)
  }
}

export const collaborationClosingRouter = Router()
export const collaborationPublicRouter = Router()

collaborationClosingRouter.get('/:dealId/closing-report', collaborationRateLimit({ scope: 'closing-read', limit: 60, windowMs: 60_000 }), asyncRoute(async (request, response) => {
  const actor = await loadAgent(request, response)
  if (!actor) return
  const dealId = parseId(request.params.dealId)
  if (dealId === null) {
    response.status(400).json({ error: 'Identifiant de dossier invalide.' })
    return
  }
  const data = await prisma.$transaction(async (transaction) => {
    const deal = await findCollaborationDealForActor(transaction, actor, dealId)
    assertNotSigned(deal.status)
    if (deal.closerId !== actor.id || actor.role !== 'AGENT' || actor.status !== 'ACTIF') {
      throw new CollaborationAccessError('Seul le closer actif de ce dossier peut consulter le rapport de clôture.', 404)
    }
    const report = await transaction.collaborationClosingReport.findUnique({
      where: { dealId },
      include: { evidence: { orderBy: { createdAt: 'asc' } } },
    })
    return report ? {
      id: report.id,
      status: report.status,
      saleAmount: report.saleAmount?.toString() ?? null,
      saleDate: report.saleDate,
      details: report.details,
      reportedAt: report.reportedAt,
      submittedAt: report.submittedAt,
      evidence: report.evidence.map(({ id, fileName, mimeType, fileSize, sha256, createdAt, storageKey }) => ({
        id, fileName, mimeType, fileSize, sha256, createdAt, downloadUrl: createSignedEvidenceUrl(id, storageKey),
      })),
    } : null
  })
  response.json({ data })
}))

collaborationClosingRouter.put('/:dealId/closing-report/draft', collaborationRateLimit({ scope: 'closing-draft', limit: 20, windowMs: 60_000 }), asyncRoute(async (request, response) => {
  const actor = await loadAgent(request, response)
  if (!actor) return
  const dealId = parseId(request.params.dealId)
  const body = draftSchema.safeParse(request.body)
  if (dealId === null) {
    response.status(400).json({ error: 'Identifiant de dossier invalide.' })
    return
  }
  if (!body.success || Object.keys(body.data ?? {}).length === 0) {
    response.status(400).json({ error: 'Le brouillon doit contenir au moins un champ valide.', details: body.success ? undefined : body.error.flatten() })
    return
  }
  const audit = requestAudit(request)
  const report = await prisma.$transaction(async (transaction) => {
    const deal = await findCollaborationDealForActor(transaction, actor, dealId)
    assertNotSigned(deal.status)
    if (!closingPermission(actor, deal)) throw new CollaborationAccessError('Seul le closer actif de ce dossier peut enregistrer un brouillon.', 404)
    const current = await transaction.collaborationClosingReport.findUnique({ where: { dealId } })
    if (current?.status === 'SUBMITTED') throw new CollaborationAccessError('Le rapport soumis est immuable; ajoutez un complément tracé.', 409)
    const data = {
      ...(body.data.saleAmount === undefined ? {} : { saleAmount: body.data.saleAmount === null ? null : BigInt(body.data.saleAmount) }),
      ...(body.data.saleDate === undefined ? {} : { saleDate: body.data.saleDate === null ? null : new Date(body.data.saleDate) }),
      ...(body.data.details === undefined ? {} : { details: body.data.details }),
    }
    const saved = current
      ? await transaction.collaborationClosingReport.update({ where: { id: current.id }, data })
      : await transaction.collaborationClosingReport.create({ data: { dealId, closerId: actor.id, ...data } })
    await writeCollaborationAudit(transaction, {
      actorId: actor.id,
      dealId,
      action: 'CLOSING_DRAFT_SAVED',
      entityType: 'CollaborationClosingReport',
      entityId: saved.id,
      metadata: { suppliedFields: Object.keys(body.data) },
      ...audit,
    })
    return saved
  })
  response.json({ data: { id: report.id, status: report.status, saleAmount: report.saleAmount?.toString() ?? null, saleDate: report.saleDate, details: report.details } })
}))

collaborationClosingRouter.post('/:dealId/closing-report/attachments', collaborationRateLimit({ scope: 'closing-upload', limit: 15, windowMs: 60_000 }), parseUpload, asyncRoute(async (request, response) => {
  const actor = await loadAgent(request, response)
  if (!actor) return
  const dealId = parseId(request.params.dealId)
  const file = request.file
  if (dealId === null || !file) {
    response.status(400).json({ error: 'Identifiant de dossier et fichier requis.' })
    return
  }
  const persisted = await persistCollaborationFile(file)
  const audit = requestAudit(request)
  try {
    const evidence = await prisma.$transaction(async (transaction) => {
      const deal = await findCollaborationDealForActor(transaction, actor, dealId)
      assertNotSigned(deal.status)
      if (!closingPermission(actor, deal)) throw new CollaborationAccessError('Seul le closer actif de ce dossier peut ajouter une pièce.', 404)
      let closingReport = await transaction.collaborationClosingReport.findUnique({ where: { dealId } })
      if (!closingReport) closingReport = await transaction.collaborationClosingReport.create({ data: { dealId, closerId: actor.id } })
      if (closingReport.status !== 'DRAFT') throw new CollaborationAccessError('Le rapport est soumis; les pièces ne sont plus modifiables.', 409)
      const created = await transaction.collaborationEvidence.create({
        data: {
          dealId,
          closingReportId: closingReport.id,
          uploadedById: actor.id,
          type: 'CLOSING_ATTACHMENT',
          ...persisted,
        },
      })
      await writeCollaborationAudit(transaction, {
        actorId: actor.id,
        dealId,
        action: 'CLOSING_EVIDENCE_UPLOADED',
        entityType: 'CollaborationEvidence',
        entityId: created.id,
        metadata: { sha256: persisted.sha256, mimeType: persisted.mimeType, fileSize: persisted.fileSize },
        ...audit,
      })
      return created
    })
    response.status(201).json({
      data: {
        id: evidence.id,
        fileName: evidence.fileName,
        mimeType: evidence.mimeType,
        fileSize: evidence.fileSize,
        sha256: evidence.sha256,
        downloadUrl: createSignedEvidenceUrl(evidence.id, evidence.storageKey),
      },
    })
  } catch (error) {
    await removeCollaborationFile(persisted.storageKey).catch((cleanupError: unknown) => {
      console.error('Failed to remove unattached collaboration evidence:', cleanupError)
    })
    throw error
  }
}))

collaborationClosingRouter.post('/:dealId/closing-report/submit', collaborationRateLimit({ scope: 'closing-submit', limit: 5, windowMs: 60_000 }), asyncRoute(async (request, response) => {
  const actor = await loadAgent(request, response)
  if (!actor) return
  const dealId = parseId(request.params.dealId)
  const body = submitSchema.safeParse(request.body)
  if (dealId === null || !body.success) {
    response.status(400).json({ error: 'Identifiant ou clé idempotente invalide.', details: body.success ? undefined : body.error.flatten() })
    return
  }
  const now = new Date()
  const audit = requestAudit(request)
  const result = await prisma.$transaction(async (transaction) => {
    const deal = await findCollaborationDealForActor(transaction, actor, dealId, now)
    assertNotSigned(deal.status)
    if (!closingPermission(actor, deal, now)) throw new CollaborationAccessError('L’accès du closer est expiré, révoqué ou ne concerne pas ce prospect.', 409)
    const report = await transaction.collaborationClosingReport.findUnique({
      where: { dealId },
      include: { deal: { include: { secret: true, report: { select: { agentId: true } } } } },
    })
    if (!report || report.closerId !== actor.id || report.saleAmount === null || !report.saleDate || !report.details?.trim()) {
      throw new CollaborationAccessError('Complétez le montant, la date et la description avant de soumettre.', 409)
    }
    if (report.status === 'SUBMITTED') {
      if (report.idempotencyKey === body.data.idempotencyKey) return { duplicate: true, reportId: report.id, supplierId: deal.supplierId }
      throw new CollaborationAccessError('Ce rapport a déjà été soumis.', 409)
    }
    const customerEmail = report.deal.secret?.emailCiphertext
      ? decryptPii(report.deal.secret.emailCiphertext)
      : null
    if (env.clientConfirmationRequired && !customerEmail) {
      throw new CollaborationAccessError('Une adresse email du client est requise pour demander sa confirmation.', 409)
    }
    const submitted = await transaction.collaborationClosingReport.updateMany({
      where: { id: report.id, status: 'DRAFT' },
      data: { status: 'SUBMITTED', idempotencyKey: body.data.idempotencyKey, submittedAt: now },
    })
    if (submitted.count !== 1) throw new CollaborationAccessError('Ce rapport a déjà été soumis.', 409)
    await transitionCollaborationDeal(transaction, actor, dealId, 'CLOSING_REPORTED', 'Le closer a soumis son rapport de clôture.', now)

    let confirmationId: number | null = null
    if (env.clientConfirmationRequired) {
      const code = createClientConfirmationCode()
      const publicToken = createClientConfirmationPublicToken()
      const confirmation = await transaction.collaborationClientConfirmation.create({
        data: {
          dealId,
          publicTokenHash: hashClientConfirmationPublicToken(publicToken),
          codeHash: '0'.repeat(64),
          expiresAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
        },
      })
      confirmationId = confirmation.id
      await transaction.collaborationClientConfirmation.update({
        where: { id: confirmation.id },
        data: { codeHash: hashClientConfirmationCode(code, confirmation.id) },
      })
      const confirmationUrl = `${env.clientAppUrl}/confirmation-client/${publicToken}`
      await enqueueCollaborationEmail(transaction, {
        dealId,
        type: 'CLIENT_CONFIRMATION_CODE',
        recipient: customerEmail!,
        idempotencyKey: `client-confirmation:${confirmation.id}`,
        payload: { audience: 'client', codeCiphertext: encryptPii(code), confirmationUrl },
      })
      await writeCollaborationAudit(transaction, {
        actorId: actor.id,
        dealId,
        action: 'CLIENT_CONFIRMATION_CODE_QUEUED',
        entityType: 'CollaborationClientConfirmation',
        entityId: confirmation.id,
        metadata: { expiresAt: confirmation.expiresAt.toISOString(), deliveryChannel: 'EMAIL' },
        ...audit,
        createdAt: now,
      })
    }
    await writeCollaborationAudit(transaction, {
      actorId: actor.id,
      dealId,
      action: 'CLOSING_REPORT_SUBMITTED',
      entityType: 'CollaborationClosingReport',
      entityId: report.id,
      metadata: { reportId: report.id, confirmationRequired: env.clientConfirmationRequired },
      ...audit,
      createdAt: now,
    })
    return { duplicate: false, reportId: report.id, supplierId: deal.supplierId, confirmationId }
  })
  if (!result.duplicate) {
    await Promise.all([
      notifyUser(result.supplierId, {
        type: 'COLLABORATION_CLOSING_REPORTED',
        title: 'Rapport de clôture soumis',
        body: 'Le closer déclare avoir conclu le prospect partagé.',
        link: `/collaboration/${dealId}/timeline`,
        actorId: actor.id,
      }),
      notifyAdmins({
        type: 'COLLABORATION_CLOSING_REPORTED',
        title: 'Clôture à vérifier',
        body: 'Un closer déclare avoir conclu un prospect partagé.',
        link: `/admin/collaboration/${dealId}`,
        actorId: actor.id,
      }),
    ])
  }
  response.status(result.duplicate ? 200 : 201).json({ data: { reportId: result.reportId, status: 'SUBMITTED', idempotentReplay: result.duplicate } })
}))

collaborationClosingRouter.post('/:dealId/closing-report/supplements', collaborationRateLimit({ scope: 'closing-supplement', limit: 10, windowMs: 60_000 }), asyncRoute(async (request, response) => {
  const actor = await loadAgent(request, response)
  if (!actor) return
  const dealId = parseId(request.params.dealId)
  const body = supplementSchema.safeParse(request.body)
  if (dealId === null || !body.success) {
    response.status(400).json({ error: 'Complément invalide.', details: body.success ? undefined : body.error.flatten() })
    return
  }
  const audit = requestAudit(request)
  const supplement = await prisma.$transaction(async (transaction) => {
    const deal = await findCollaborationDealForActor(transaction, actor, dealId)
    assertNotSigned(deal.status)
    if (deal.closerId !== actor.id || actor.role !== 'AGENT' || actor.status !== 'ACTIF') {
      throw new CollaborationAccessError('Seul le closer actif de ce dossier peut ajouter un complément.', 404)
    }
    const report = await transaction.collaborationClosingReport.findUnique({ where: { dealId } })
    if (!report || report.status !== 'SUBMITTED') throw new CollaborationAccessError('Aucun rapport soumis à compléter.', 409)
    const created = await transaction.collaborationClosingSupplement.create({
      data: { closingReportId: report.id, authorId: actor.id, details: body.data.details },
    })
    await writeCollaborationAudit(transaction, {
      actorId: actor.id,
      dealId,
      action: 'CLOSING_REPORT_SUPPLEMENTED',
      entityType: 'CollaborationClosingSupplement',
      entityId: created.id,
      metadata: { supplementId: created.id },
      ...audit,
    })
    return created
  })
  response.status(201).json({ data: supplement })
}))

collaborationClosingRouter.post('/:dealId/lost', collaborationRateLimit({ scope: 'closing-lost', limit: 5, windowMs: 60_000 }), asyncRoute(async (request, response) => {
  const actor = await loadAgent(request, response)
  if (!actor) return
  const dealId = parseId(request.params.dealId)
  const body = lostSchema.safeParse(request.body)
  if (dealId === null || !body.success) {
    response.status(400).json({ error: 'Motif de perte invalide.', details: body.success ? undefined : body.error.flatten() })
    return
  }
  const audit = requestAudit(request)
  const availabilityNotifications = await prisma.$transaction(async (transaction) => {
    const deal = await findCollaborationDealForActor(transaction, actor, dealId)
    assertNotSigned(deal.status)
    if (!canDeclareCollaborationLost(actor, deal)) throw new CollaborationAccessError('Seul le closer actif de ce dossier peut le déclarer perdu.', 409)
    await transitionCollaborationDeal(transaction, actor, dealId, 'LOST', 'Le closer a déclaré le prospect perdu.', new Date())
    await transaction.collaborationDeal.update({ where: { id: dealId }, data: { lostReason: body.data.reason } })
    const notifications = await createAvailabilityNotifications(transaction, dealId, [deal.supplierId])
    await writeCollaborationAudit(transaction, {
      actorId: actor.id,
      dealId,
      action: 'COLLABORATION_DEAL_DECLARED_LOST',
      entityType: 'CollaborationDeal',
      entityId: dealId,
      metadata: { reason: body.data.reason },
      ...audit,
    })
    return notifications
  })
  availabilityNotifications.forEach((notification) => publishNotification(notification))
  await notifyAdmins({
    type: 'COLLABORATION_DEAL_LOST',
    title: 'Prospect déclaré perdu',
    body: 'Le closer a déclaré un prospect partagé comme perdu.',
    link: `/admin/collaboration/${dealId}`,
  })
  response.json({ data: { status: 'LOST' } })
}))

collaborationClosingRouter.post('/:dealId/disputes', collaborationRateLimit({ scope: 'closing-dispute', limit: 5, windowMs: 60_000 }), asyncRoute(async (request, response) => {
  const actor = await loadAgent(request, response)
  if (!actor) return
  const dealId = parseId(request.params.dealId)
  const body = disputeSchema.safeParse(request.body)
  if (dealId === null || !body.success) {
    response.status(400).json({ error: 'Motif de contestation invalide.', details: body.success ? undefined : body.error.flatten() })
    return
  }
  const audit = requestAudit(request)
  await prisma.$transaction(async (transaction) => {
    const deal = await transaction.collaborationDeal.findUnique({ where: { id: dealId }, select: { id: true, supplierId: true, status: true } })
    if (!deal || deal.supplierId !== actor.id || !['LOST', 'CLOSING_REPORTED'].includes(deal.status)) {
      throw new CollaborationAccessError('Seul le fournisseur de ce dossier peut le contester.', deal ? 409 : 404)
    }
    await transitionCollaborationDeal(transaction, actor, dealId, 'DISPUTED', 'Le fournisseur conteste le résultat.', new Date())
    await transaction.collaborationDeal.update({ where: { id: dealId }, data: { disputeReason: body.data.reason } })
    await holdPendingCommissionsForDeal(transaction, dealId, 'DEAL_DISPUTED', { actorId: actor.id, ...audit })
    await writeCollaborationAudit(transaction, {
      actorId: actor.id,
      dealId,
      action: 'COLLABORATION_DEAL_DISPUTED',
      entityType: 'CollaborationDeal',
      entityId: dealId,
      metadata: { reason: body.data.reason },
      ...audit,
    })
  })
  await notifyAdmins({
    type: 'COLLABORATION_DEAL_DISPUTED',
    title: 'Prospect contesté',
    body: 'Le fournisseur conteste le résultat déclaré sur un prospect.',
    link: `/admin/collaboration/${dealId}`,
  })
  response.json({ data: { status: 'DISPUTED' } })
}))

collaborationClosingRouter.get('/:dealId/timeline', collaborationRateLimit({ scope: 'closing-timeline', limit: 60, windowMs: 60_000 }), asyncRoute(async (request, response) => {
  const actor = await loadAgent(request, response)
  if (!actor) return
  const dealId = parseId(request.params.dealId)
  if (dealId === null) {
    response.status(400).json({ error: 'Identifiant de dossier invalide.' })
    return
  }
  const deal = await prisma.collaborationDeal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      supplierId: true,
      closerId: true,
      status: true,
      declaredAt: true,
      accessGrantedAt: true,
      accessExpiresAt: true,
      closingReportedAt: true,
      clientConfirmedAt: true,
      confirmedAt: true,
      contractSignedAt: true,
      saleNumber: true,
      accessRequests: {
        where: { requesterId: actor.id, status: 'APPROVED' },
        select: { requesterId: true },
      },
      statusHistory: { orderBy: { createdAt: 'asc' }, select: { toStatus: true, createdAt: true } },
    },
  })
  const signedCloser = deal
    && (deal.status === 'CONTRACT_SIGNED' || deal.status === 'COMMISSIONS_PAID')
    && deal.closerId === actor.id
    && deal.accessRequests.length > 0
  if (!deal || (deal.supplierId !== actor.id && !signedCloser)) {
    response.status(404).json({ error: 'Chronologie introuvable.' })
    return
  }
  response.json({ data: serializeSupplierCollaborationTimeline(deal) })
}))

const unavailablePublicConfirmation = { error: 'Lien de confirmation invalide ou expiré.' }

function publicTokenFromRequest(request: Request): string | null {
  const token = request.params.publicToken
  return typeof token === 'string' && isClientConfirmationPublicToken(token) ? token : null
}

collaborationPublicRouter.get('/confirmations/:publicToken', collaborationRateLimit({
  scope: 'client-confirmation-read',
  limit: 30,
  windowMs: 60_000,
  key: (request) => request.ip ?? 'unknown',
}), asyncRoute(async (request, response) => {
  const publicToken = publicTokenFromRequest(request)
  if (!publicToken) {
    response.status(404).json(unavailablePublicConfirmation)
    return
  }
  const tokenHash = hashClientConfirmationPublicToken(publicToken)
  const confirmation = await prisma.collaborationClientConfirmation.findUnique({
    where: { publicTokenHash: tokenHash },
    select: { publicTokenHash: true, status: true, expiresAt: true },
  })
  if (!confirmation
    || !compareClientConfirmationTokenHashes(tokenHash, confirmation.publicTokenHash)
    || confirmation.status !== 'PENDING'
    || confirmation.expiresAt <= new Date()) {
    response.status(404).json(unavailablePublicConfirmation)
    return
  }
  response.json({ data: { status: confirmation.status, expiresAt: confirmation.expiresAt } })
}))

collaborationPublicRouter.post('/confirmations/:publicToken/respond', collaborationRateLimit({
  scope: 'client-confirmation-submit',
  limit: 10,
  windowMs: 60_000,
  blockMs: 15 * 60_000,
  key: (request) => request.ip ?? 'unknown',
}), asyncRoute(async (request, response) => {
  const publicToken = publicTokenFromRequest(request)
  const body = confirmationSchema.safeParse(request.body)
  if (!publicToken) {
    response.status(404).json(unavailablePublicConfirmation)
    return
  }
  if (!body.success) {
    response.status(400).json({ error: 'Réponse de confirmation invalide.' })
    return
  }
  const tokenHash = hashClientConfirmationPublicToken(publicToken)
  const candidate = await prisma.collaborationClientConfirmation.findUnique({
    where: { publicTokenHash: tokenHash },
    select: { id: true, publicTokenHash: true },
  })
  if (!candidate || !compareClientConfirmationTokenHashes(tokenHash, candidate.publicTokenHash)) {
    response.status(404).json(unavailablePublicConfirmation)
    return
  }
  const confirmationId = candidate.id
  const now = new Date()
  const audit = requestAudit(request)
  const result = await prisma.$transaction(async (transaction) => {
    const confirmation = await transaction.collaborationClientConfirmation.findUnique({
      where: { id: confirmationId },
      include: { deal: { select: { id: true, status: true } } },
    })
    if (!confirmation) return { outcome: 'UNAVAILABLE' as const }
    const assessment = assessClientConfirmationAttempt(confirmation, body.data.code, now)
    if (assessment.outcome === 'ALREADY_USED') {
      await writeCollaborationAudit(transaction, {
        dealId: confirmation.dealId,
        action: 'CLIENT_CONFIRMATION_ATTEMPT_REJECTED',
        entityType: 'CollaborationClientConfirmation',
        entityId: confirmationId,
        metadata: { outcome: 'ALREADY_USED' },
        ...audit,
        createdAt: now,
      })
      return { outcome: 'UNAVAILABLE' as const }
    }
    if (assessment.outcome === 'EXPIRED') {
      await writeCollaborationAudit(transaction, {
        dealId: confirmation.dealId,
        action: 'CLIENT_CONFIRMATION_ATTEMPT_REJECTED',
        entityType: 'CollaborationClientConfirmation',
        entityId: confirmationId,
        metadata: { outcome: 'EXPIRED' },
        ...audit,
        createdAt: now,
      })
      return { outcome: 'UNAVAILABLE' as const }
    }
    if (assessment.outcome === 'BLOCKED') {
      await writeCollaborationAudit(transaction, {
        dealId: confirmation.dealId,
        action: 'CLIENT_CONFIRMATION_ATTEMPT_REJECTED',
        entityType: 'CollaborationClientConfirmation',
        entityId: confirmationId,
        metadata: { outcome: 'BLOCKED' },
        ...audit,
        createdAt: now,
      })
      return { outcome: 'BLOCKED' as const }
    }
    if (assessment.outcome === 'VALID' && assessment.resetAttempts) {
      await transaction.collaborationClientConfirmation.update({
        where: { id: confirmationId },
        data: { attempts: 0, blockedUntil: null },
      })
      confirmation.attempts = 0
      confirmation.blockedUntil = null
    }
    if (assessment.outcome === 'INVALID') {
      const attempts = assessment.attempts
      const attemptUpdate = await transaction.collaborationClientConfirmation.updateMany({
        where: { id: confirmationId, status: 'PENDING', attempts: confirmation.attempts },
        data: {
          attempts,
          blockedUntil: assessment.blockedUntil,
        },
      })
      if (attemptUpdate.count !== 1) {
        await writeCollaborationAudit(transaction, {
          dealId: confirmation.dealId,
          action: 'CLIENT_CONFIRMATION_ATTEMPT_REJECTED',
          entityType: 'CollaborationClientConfirmation',
          entityId: confirmationId,
          metadata: { outcome: 'RACE' },
          ...audit,
          createdAt: now,
        })
        return { outcome: 'UNAVAILABLE' as const }
      }
      await writeCollaborationAudit(transaction, {
        dealId: confirmation.dealId,
        action: 'CLIENT_CONFIRMATION_ATTEMPT_FAILED',
        entityType: 'CollaborationClientConfirmation',
        entityId: confirmationId,
        metadata: { attempts, blocked: attempts >= 5 },
        ...audit,
        createdAt: now,
      })
      return { outcome: 'INVALID' as const, attempts }
    }
    const status = body.data.answer === 'CONFIRMED' ? 'CONFIRMED_BY_CLIENT' : 'DENIED'
    const updated = await transaction.collaborationClientConfirmation.updateMany({
      where: { id: confirmationId, status: 'PENDING', expiresAt: { gt: now } },
      data: { status, respondedAt: now, attempts: { increment: 1 } },
    })
    if (updated.count !== 1) return { outcome: 'UNAVAILABLE' as const }
    if (!['CLOSING_REPORTED', 'DISPUTED'].includes(confirmation.deal.status)) {
      throw new CollaborationAccessError('Le dossier ne peut plus recevoir de réponse client.', 409)
    }
    if (confirmation.deal.status === 'CLOSING_REPORTED') {
      await transitionCollaborationDeal(
        transaction,
        { role: 'SYSTEM' },
        confirmation.dealId,
        status === 'DENIED' ? 'DISPUTED' : 'CONFIRMED_BY_CLIENT',
        status === 'DENIED' ? 'Le client conteste la réalisation déclarée.' : 'Le client a confirmé la réalisation.',
        now,
      )
    }
    if (status === 'DENIED') {
      await holdPendingCommissionsForDeal(transaction, confirmation.dealId, 'CLIENT_DENIED', { ...audit }, now)
    }
    await transaction.collaborationDeal.update({
      where: { id: confirmation.dealId },
      data: {
        clientConfirmedAt: status === 'CONFIRMED_BY_CLIENT' ? now : undefined,
        ...(status === 'DENIED' ? { disputeReason: 'Le client conteste la réalisation déclarée.' } : {}),
      },
    })
    await writeCollaborationAudit(transaction, {
      dealId: confirmation.dealId,
      action: 'CLIENT_CONFIRMATION_RECORDED',
      entityType: 'CollaborationClientConfirmation',
      entityId: confirmationId,
      metadata: { result: status },
      ...audit,
      createdAt: now,
    })
    return { outcome: status as 'CONFIRMED_BY_CLIENT' | 'DENIED', dealId: confirmation.dealId }
  })
  if (result.outcome === 'UNAVAILABLE') {
    response.status(404).json(unavailablePublicConfirmation)
    return
  }
  if (result.outcome === 'BLOCKED') {
    response.status(409).json({ error: 'Trop de tentatives. Réessayez après le blocage temporaire.' })
    return
  }
  if (result.outcome === 'INVALID') {
    response.status(400).json({ error: 'Code incorrect.', attemptsRemaining: Math.max(0, 5 - result.attempts) })
    return
  }
  if (result.outcome === 'DENIED') {
    await notifyAdmins({
      type: 'COLLABORATION_CLIENT_DENIED',
      title: 'Confirmation client refusée',
      body: 'Un client conteste la réalisation déclarée. Le dossier est en litige.',
      link: `/admin/collaboration/${result.dealId}`,
    })
  }
  response.json({ data: { result: result.outcome } })
}))

collaborationPublicRouter.get('/files/:evidenceId', collaborationRateLimit({ scope: 'signed-file-download', limit: 20, windowMs: 60_000 }), asyncRoute(async (request, response) => {
  const evidenceId = parseId(request.params.evidenceId)
  const expiresAt = Number(request.query.expires)
  const sig = typeof request.query.sig === 'string' ? request.query.sig : ''
  if (evidenceId === null) {
    response.status(403).json({ error: 'Lien de téléchargement invalide ou expiré.' })
    return
  }
  const evidence = await prisma.collaborationEvidence.findUnique({
    where: { id: evidenceId },
    select: { storageKey: true, dealId: true },
  })
  if (!evidence) {
    response.status(404).json({ error: 'Fichier introuvable.' })
    return
  }
  if (!isValidSignedEvidenceUrl(evidenceId, evidence.storageKey, expiresAt, sig)) {
    response.status(403).json({ error: 'Lien de téléchargement invalide ou expiré.' })
    return
  }
  const audit = requestAudit(request)
  await prisma.$transaction((transaction) => writeCollaborationAudit(transaction, {
    dealId: evidence.dealId,
    action: 'COLLABORATION_EVIDENCE_DOWNLOADED',
    entityType: 'CollaborationEvidence',
    entityId: evidenceId,
    metadata: { signedLink: true },
    ...audit,
  }))
  await sendSignedEvidence(evidenceId, evidence.storageKey, expiresAt, sig, response)
}))

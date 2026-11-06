import type { Prisma } from '@prisma/client';
import type { CollaborationAccessStatus, CollaborationDealStatus } from '@prisma/client';
import type { AuthUser } from '../auth/auth.middleware.js';
import { writeCollaborationAudit } from './collaboration.audit.js'

type CollaborationActor = Pick<AuthUser, 'id' | 'role' | 'status'>;
type ActiveAccess = { requesterId: number; status: CollaborationAccessStatus; decidedAt: Date | null };
type DealAuthorizationContext = {
  id: number;
  supplierId: number;
  closerId: number | null;
  status: CollaborationDealStatus;
  accessGrantedAt: Date | null;
  accessExpiresAt: Date | null;
  accessRequests: ActiveAccess[];
};

type Principal = CollaborationActor | { role: 'SYSTEM' };
type TransitionRule = { roles: readonly Principal['role'][]; requireActiveCloserAccess?: boolean };

const transitionRules: Partial<Record<CollaborationDealStatus, Partial<Record<CollaborationDealStatus, TransitionRule>>>> = {
  DECLARED: {
    ACCESS_REQUESTED: { roles: ['AGENT'] },
  },
  EXPIRED: {
    ACCESS_REQUESTED: { roles: ['AGENT'] },
  },
  ACCESS_REQUESTED: {
    IN_PROGRESS: { roles: ['AGENT', 'ADMIN', 'SUPER_ADMIN'] },
    DECLARED: { roles: ['SYSTEM'] },
  },
  IN_PROGRESS: {
    CLOSING_REPORTED: { roles: ['AGENT'], requireActiveCloserAccess: true },
    LOST: { roles: ['AGENT'], requireActiveCloserAccess: true },
    EXPIRED: { roles: ['SYSTEM'] },
  },
  CLOSING_REPORTED: {
    CLIENT_CONFIRMED: { roles: ['SYSTEM'] },
    CONFIRMED_BY_CLIENT: { roles: ['SYSTEM'] },
    NO_RESPONSE: { roles: ['SYSTEM'] },
    CONFIRMED: { roles: ['ADMIN', 'SUPER_ADMIN'] },
    DISPUTED: { roles: ['SYSTEM', 'AGENT', 'ADMIN', 'SUPER_ADMIN'] },
    REJECTED: { roles: ['ADMIN', 'SUPER_ADMIN'] },
  },
  CONFIRMED_BY_CLIENT: {
    CONFIRMED: { roles: ['ADMIN', 'SUPER_ADMIN'] },
    REJECTED: { roles: ['ADMIN', 'SUPER_ADMIN'] },
    DISPUTED: { roles: ['ADMIN', 'SUPER_ADMIN'] },
  },
  CLIENT_CONFIRMED: {
    CONFIRMED: { roles: ['ADMIN', 'SUPER_ADMIN'] },
    REJECTED: { roles: ['ADMIN', 'SUPER_ADMIN'] },
    DISPUTED: { roles: ['ADMIN', 'SUPER_ADMIN'] },
  },
  NO_RESPONSE: {
    CONFIRMED: { roles: ['ADMIN', 'SUPER_ADMIN'] },
    REJECTED: { roles: ['ADMIN', 'SUPER_ADMIN'] },
    DISPUTED: { roles: ['ADMIN', 'SUPER_ADMIN'] },
  },
  CONFIRMED: {
    CONTRACT_SIGNED: { roles: ['ADMIN', 'SUPER_ADMIN'] },
    DISPUTED: { roles: ['SYSTEM', 'ADMIN', 'SUPER_ADMIN'] },
  },
  CONTRACT_SIGNED: {
    COMMISSIONS_PAID: { roles: ['ADMIN', 'SUPER_ADMIN'] },
    DISPUTED: { roles: ['SYSTEM', 'ADMIN', 'SUPER_ADMIN'] },
  },
  COMMISSIONS_PAID: {
    DISPUTED: { roles: ['SYSTEM', 'ADMIN', 'SUPER_ADMIN'] },
  },
  LOST: {
    ACCESS_REQUESTED: { roles: ['AGENT'] },
    DISPUTED: { roles: ['AGENT', 'ADMIN', 'SUPER_ADMIN'] },
    EXPIRED: { roles: ['SYSTEM'] },
  },
  DISPUTED: {
    IN_PROGRESS: { roles: ['ADMIN', 'SUPER_ADMIN'] },
    CONFIRMED: { roles: ['ADMIN', 'SUPER_ADMIN'] },
    CONTRACT_SIGNED: { roles: ['ADMIN', 'SUPER_ADMIN'] },
    COMMISSIONS_PAID: { roles: ['ADMIN', 'SUPER_ADMIN'] },
    REJECTED: { roles: ['ADMIN', 'SUPER_ADMIN'] },
    EXPIRED: { roles: ['SYSTEM', 'ADMIN', 'SUPER_ADMIN'] },
  },
}

function isActiveAdmin(actor: CollaborationActor): boolean {
  return actor.status === 'ACTIF' && (actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN')
}

function hasActiveCloserAccess(
  actor: CollaborationActor,
  deal: DealAuthorizationContext,
  now: Date,
): boolean {
  const approvedRequest = deal.accessRequests.some((request) =>
    request.requesterId === actor.id && request.status === 'APPROVED' && request.decidedAt !== null,
  )
  return actor.role === 'AGENT'
    && actor.status === 'ACTIF'
    && deal.closerId === actor.id
    && approvedRequest
    && deal.accessGrantedAt !== null
    && deal.accessGrantedAt <= now
    && deal.accessExpiresAt !== null
    && deal.accessExpiresAt > now
    && !['LOST', 'REJECTED', 'DISPUTED', 'EXPIRED'].includes(deal.status)
}

export function canViewCollaborationDeal(actor: CollaborationActor, deal: DealAuthorizationContext, now = new Date()): boolean {
  if (isActiveAdmin(actor)) return true
  if (actor.role !== 'AGENT' || actor.status !== 'ACTIF') return false
  return deal.supplierId === actor.id || hasActiveCloserAccess(actor, deal, now)
}

export function canRequestCollaborationAccess(actor: CollaborationActor, deal: Pick<DealAuthorizationContext, 'supplierId' | 'status'>): boolean {
  return actor.role === 'AGENT'
    && actor.status === 'ACTIF'
    && actor.id !== deal.supplierId
    && (deal.status === 'DECLARED' || deal.status === 'ACCESS_REQUESTED' || deal.status === 'EXPIRED' || deal.status === 'LOST')
}

export function isSignedCollaborationStatus(status: CollaborationDealStatus): boolean {
  return status === 'CONTRACT_SIGNED' || status === 'COMMISSIONS_PAID'
}

export function canManageCollaborationAccess(actor: CollaborationActor, deal: Pick<DealAuthorizationContext, 'supplierId'>): boolean {
  return isActiveAdmin(actor) || (actor.role === 'AGENT' && actor.status === 'ACTIF' && actor.id === deal.supplierId)
}

export function canSubmitCollaborationClosing(actor: CollaborationActor, deal: DealAuthorizationContext, now = new Date()): boolean {
  return deal.status === 'IN_PROGRESS' && hasActiveCloserAccess(actor, deal, now)
}

export function canDeclareCollaborationLost(actor: CollaborationActor, deal: DealAuthorizationContext, now = new Date()): boolean {
  return deal.status === 'IN_PROGRESS' && hasActiveCloserAccess(actor, deal, now)
}

export function canSignCollaborationDeal(input: {
  dealStatus: CollaborationDealStatus
  saleNumber: string | null
  closingReportStatus: 'DRAFT' | 'SUBMITTED' | null
  confirmationRequired: boolean
  confirmationStatus: string | null
  confirmationOverridden: boolean
}): boolean {
  return input.dealStatus === 'CONFIRMED'
    && input.saleNumber === null
    && input.closingReportStatus === 'SUBMITTED'
    && (!input.confirmationRequired
      || input.confirmationStatus === 'CONFIRMED_BY_CLIENT'
      || input.confirmationStatus === 'CONFIRMED'
      || input.confirmationOverridden)
}

export function canTransitionCollaborationDeal(
  principal: Principal,
  deal: DealAuthorizationContext,
  target: CollaborationDealStatus,
  now = new Date(),
): boolean {
  const rule = transitionRules[deal.status]?.[target]
  if (!rule || !rule.roles.includes(principal.role)) return false
  if (principal.role === 'SYSTEM') return true

  const actor = principal
  if (actor.status !== 'ACTIF') return false
  if (target === 'ACCESS_REQUESTED') return canRequestCollaborationAccess(actor, deal)
  if (target === 'IN_PROGRESS' && deal.status === 'ACCESS_REQUESTED') {
    return canManageCollaborationAccess(actor, deal)
      && deal.closerId !== null
      && deal.accessRequests.some((request) =>
        request.requesterId === deal.closerId && request.status === 'APPROVED' && request.decidedAt !== null,
      )
  }
  if (target === 'CLOSING_REPORTED' || target === 'LOST') return hasActiveCloserAccess(actor, deal, now)
  if (target === 'DISPUTED' && (deal.status === 'LOST' || deal.status === 'CLOSING_REPORTED')) {
    return isActiveAdmin(actor) || (actor.role === 'AGENT' && actor.id === deal.supplierId)
  }
  if (rule.requireActiveCloserAccess) return hasActiveCloserAccess(actor, deal, now)
  return isActiveAdmin(actor)
}

export class CollaborationAccessError extends Error {
  constructor(
    message: string,
    readonly statusCode: 404 | 409,
  ) {
    super(message)
    this.name = 'CollaborationAccessError'
  }
}

export async function findCollaborationDealForActor(
  transaction: Prisma.TransactionClient,
  actor: CollaborationActor,
  dealId: number,
  now = new Date(),
) {
  const deal = await transaction.collaborationDeal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      reportId: true,
      supplierId: true,
      closerId: true,
      status: true,
      accessGrantedAt: true,
      accessExpiresAt: true,
      report: { select: { status: true } },
      accessRequests: {
        where: { requesterId: actor.id, status: 'APPROVED' },
        select: { requesterId: true, status: true, decidedAt: true },
      },
    },
  })
  if (!deal
    || !canViewCollaborationDeal(actor, deal, now)
    || (deal.report.status === 'REJETE' && deal.supplierId !== actor.id && !isActiveAdmin(actor))) {
    throw new CollaborationAccessError('Prospect introuvable.', 404)
  }
  return deal
}

export async function transitionCollaborationDeal(
  transaction: Prisma.TransactionClient,
  principal: Principal,
  dealId: number,
  target: CollaborationDealStatus,
  comment?: string,
  now = new Date(),
) {
  const deal = await transaction.collaborationDeal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      supplierId: true,
      closerId: true,
      status: true,
      accessGrantedAt: true,
      accessExpiresAt: true,
      accessRequests: {
        where: { status: 'APPROVED' },
        select: { requesterId: true, status: true, decidedAt: true },
      },
    },
  })
  if (!deal) throw new CollaborationAccessError('Prospect introuvable.', 404)
  if (!canTransitionCollaborationDeal(principal, deal, target, now)) {
    throw new CollaborationAccessError('Cette action n’est pas autorisée pour ce prospect ou son état actuel.', 409)
  }

  const updateData: Prisma.CollaborationDealUncheckedUpdateManyInput = { status: target }
  if (target === 'CLOSING_REPORTED') updateData.closingReportedAt = now
  if (target === 'ACCESS_REQUESTED') {
    updateData.closerId = null
    updateData.accessGrantedAt = null
    updateData.accessExpiresAt = null
    updateData.resolvedAt = null
    updateData.lostReason = null
    updateData.disputeReason = null
  }
  if (target === 'CONFIRMED') {
    updateData.confirmedAt = now
    if (principal.role !== 'SYSTEM') updateData.reviewedById = principal.id
  }
  if (target === 'CONFIRMED_BY_CLIENT' || target === 'CLIENT_CONFIRMED') {
    updateData.clientConfirmedAt = now
  }
  if (target === 'CONTRACT_SIGNED' && principal.role !== 'SYSTEM') updateData.reviewedById = principal.id
  if (target === 'REJECTED' || target === 'DISPUTED' || target === 'EXPIRED') updateData.resolvedAt = now
  if (deal.status === 'IN_PROGRESS' && target === 'EXPIRED') {
    updateData.closerId = null
    updateData.accessGrantedAt = null
    updateData.accessExpiresAt = null
  }

  const update = await transaction.collaborationDeal.updateMany({
    where: { id: dealId, status: deal.status },
    data: updateData,
  })
  if (update.count !== 1) {
    throw new CollaborationAccessError('Le dossier a changé pendant cette action. Rechargez-le puis réessayez.', 409)
  }

  await transaction.collaborationDealStatusHistory.create({
    data: {
      dealId,
      fromStatus: deal.status,
      toStatus: target,
      changedBy: principal.role === 'SYSTEM' ? null : principal.id,
      comment: comment ?? null,
      createdAt: now,
    },
  })
  await writeCollaborationAudit(transaction, {
    actorId: principal.role === 'SYSTEM' ? null : principal.id,
    actorRole: principal.role,
    dealId,
    action: 'COLLABORATION_DEAL_STATE_CHANGED',
    entityType: 'CollaborationDeal',
    entityId: dealId,
    oldValues: { status: deal.status },
    newValues: { status: target },
    createdAt: now,
  })
  return transaction.collaborationDeal.findUniqueOrThrow({ where: { id: dealId } })
}

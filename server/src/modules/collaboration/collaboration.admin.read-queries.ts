import type { Prisma } from '@prisma/client'

export type AdminCollaborationFilters = {
  agentId?: number
  from?: Date
  to?: Date
  assignment?: 'ASSIGNED' | 'UNASSIGNED'
  reviewStage?: 'WAITING_CLIENT' | 'CLIENT_CONFIRMED' | 'NO_RESPONSE' | 'DISPUTED'
  sla?: 'OVERDUE'
}

export type AdminCollaborationFilterResult =
  | { filters: AdminCollaborationFilters; error: null }
  | { filters: null; error: string }

export type AdminSignedContractsFilters = {
  q?: string
  status?: 'CONTRACT_SIGNED' | 'COMMISSIONS_PAID' | 'DISPUTED'
  from?: Date
  to?: Date
}

export type AdminSignedContractsFilterResult =
  | { filters: AdminSignedContractsFilters; error: null }
  | { filters: null; error: string }

function parseInteger(value: unknown): number | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function parseDate(value: unknown): Date | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function parseAdminCollaborationFilters(query: Record<string, unknown>): AdminCollaborationFilterResult {
  const agentId = parseInteger(query.agentId)
  const from = parseDate(query.from)
  const to = parseDate(query.to)
  const assignment = query.assignment === undefined || query.assignment === 'ALL'
    ? undefined
    : query.assignment === 'ASSIGNED' || query.assignment === 'UNASSIGNED'
      ? query.assignment
      : null
  const reviewStage = query.reviewStage === undefined || query.reviewStage === 'ALL'
    ? undefined
    : query.reviewStage === 'WAITING_CLIENT'
      || query.reviewStage === 'CLIENT_CONFIRMED'
      || query.reviewStage === 'NO_RESPONSE'
      || query.reviewStage === 'DISPUTED'
      ? query.reviewStage
      : null
  const sla = query.sla === undefined || query.sla === 'ALL'
    ? undefined
    : query.sla === 'OVERDUE'
      ? query.sla
      : null
  if (agentId === null || from === null || to === null || assignment === null || reviewStage === null || sla === null || (from && to && from > to)) {
    return { filters: null, error: 'Filtres de période ou d’agent invalides.' }
  }
  return {
    filters: {
      ...(agentId === undefined ? {} : { agentId }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      ...(assignment === undefined ? {} : { assignment }),
      ...(reviewStage === undefined ? {} : { reviewStage }),
      ...(sla === undefined ? {} : { sla }),
    },
    error: null,
  }
}

export function parseAdminSignedContractsFilters(query: Record<string, unknown>): AdminSignedContractsFilterResult {
  const from = parseDate(query.from)
  const to = parseDate(query.to)
  const rawSearch = query.q
  const q = rawSearch === undefined
    ? undefined
    : typeof rawSearch === 'string' && rawSearch.trim().length <= 100
      ? rawSearch.trim()
      : null
  const status = query.status === undefined || query.status === 'ALL'
    ? undefined
    : query.status === 'CONTRACT_SIGNED' || query.status === 'COMMISSIONS_PAID' || query.status === 'DISPUTED'
      ? query.status
      : null
  if (from === null || to === null || q === null || status === null || (from && to && from > to)) {
    return { filters: null, error: 'Filtres des contrats signés invalides.' }
  }
  return {
    filters: {
      ...(q ? { q } : {}),
      ...(status ? { status } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    },
    error: null,
  }
}

function dateRange(from?: Date, to?: Date): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
}

export function buildAdminSignedContractsWhere(
  filters: AdminSignedContractsFilters,
): Prisma.CollaborationDealWhereInput {
  const contractSignedAt = dateRange(filters.from, filters.to)
  const search = filters.q
  const searchId = search && /^\d+$/.test(search) ? Number(search) : NaN
  return {
    contractSignedAt: { not: null, ...(contractSignedAt ?? {}) },
    saleNumber: { not: null },
    ...(filters.status ? { status: filters.status } : {}),
    ...(search ? {
      OR: [
        ...(Number.isSafeInteger(searchId) && searchId > 0 ? [{ id: searchId }] : []),
        { saleNumber: { contains: search } },
        { contractReference: { contains: search } },
        { report: { is: { companyName: { contains: search } } } },
        { report: { is: { contactName: { contains: search } } } },
        { report: { is: { product: { is: { title: { contains: search } } } } } },
        { report: { is: { customServiceDescription: { contains: search } } } },
      ],
    } : {}),
  }
}

function dealAgentScope(agentId?: number): Prisma.CollaborationDealWhereInput {
  return agentId === undefined ? {} : { OR: [{ supplierId: agentId }, { closerId: agentId }] }
}

function assignmentScope(
  assignment: AdminCollaborationFilters['assignment'],
  field: 'reviewAssignedToId' | 'signAssignedToId',
): Prisma.CollaborationDealWhereInput {
  if (assignment === 'ASSIGNED') return { [field]: { not: null } }
  if (assignment === 'UNASSIGNED') return { [field]: null }
  return {}
}

export const collaborationReviewStatuses = [
  'CLOSING_REPORTED',
  'CONFIRMED_BY_CLIENT',
  'CLIENT_CONFIRMED',
  'NO_RESPONSE',
  'DISPUTED',
] as const

export function buildAdminCollaborationDealsWhere(
  filters: AdminCollaborationFilters,
  status?: 'DISPUTED',
): Prisma.CollaborationDealWhereInput {
  const updatedAt = dateRange(filters.from, filters.to)
  const stageStatus: Prisma.CollaborationDealWhereInput['status'] = filters.reviewStage === 'WAITING_CLIENT'
    ? 'CLOSING_REPORTED'
    : filters.reviewStage === 'CLIENT_CONFIRMED'
      ? { in: ['CONFIRMED_BY_CLIENT', 'CLIENT_CONFIRMED'] }
      : filters.reviewStage
  return {
    status: status ?? stageStatus ?? { in: [...collaborationReviewStatuses] },
    ...dealAgentScope(filters.agentId),
    ...assignmentScope(filters.assignment, 'reviewAssignedToId'),
    ...(updatedAt ? { updatedAt } : {}),
  }
}

export function buildAdminCollaborationReadyToSignWhere(
  filters: AdminCollaborationFilters,
): Prisma.CollaborationDealWhereInput {
  const updatedAt = dateRange(filters.from, filters.to)
  return {
    status: 'CONFIRMED',
    saleNumber: null,
    ...dealAgentScope(filters.agentId),
    ...assignmentScope(filters.assignment, 'signAssignedToId'),
    ...(updatedAt ? { updatedAt } : {}),
  }
}

export function buildAdminPendingCommissionsWhere(
  filters: AdminCollaborationFilters,
): Prisma.CollaborationCommissionWhereInput {
  const generatedAt = dateRange(filters.from, filters.to)
  return {
    status: 'PENDING',
    ...(filters.agentId === undefined ? {} : { agentId: filters.agentId }),
    ...(generatedAt ? { generatedAt } : {}),
  }
}

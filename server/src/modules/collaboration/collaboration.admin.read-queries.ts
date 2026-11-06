import type { Prisma } from '@prisma/client'

export type AdminCollaborationFilters = {
  agentId?: number
  from?: Date
  to?: Date
}

export type AdminCollaborationFilterResult =
  | { filters: AdminCollaborationFilters; error: null }
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
  if (agentId === null || from === null || to === null || (from && to && from > to)) {
    return { filters: null, error: 'Filtres de période ou d’agent invalides.' }
  }
  return {
    filters: {
      ...(agentId === undefined ? {} : { agentId }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    },
    error: null,
  }
}

function dateRange(from?: Date, to?: Date): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
}

function dealAgentScope(agentId?: number): Prisma.CollaborationDealWhereInput {
  return agentId === undefined ? {} : { OR: [{ supplierId: agentId }, { closerId: agentId }] }
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
  return {
    status: status ?? { in: [...collaborationReviewStatuses] },
    ...dealAgentScope(filters.agentId),
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

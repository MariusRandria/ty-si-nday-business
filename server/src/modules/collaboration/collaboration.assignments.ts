import type { Prisma, UserRole } from '@prisma/client'
import { env } from '../../config/env.js'
import { writeCollaborationAudit } from './collaboration.audit.js'

type SalesAssignmentRole = Extract<UserRole, 'SALES_REVIEWER' | 'SALES_SIGNER'>

function reviewerEligibleStatuses(): Array<'CLOSING_REPORTED' | 'CONFIRMED_BY_CLIENT' | 'CLIENT_CONFIRMED'> {
  return env.clientConfirmationRequired
    ? ['CONFIRMED_BY_CLIENT', 'CLIENT_CONFIRMED']
    : ['CLOSING_REPORTED', 'CONFIRMED_BY_CLIENT', 'CLIENT_CONFIRMED']
}

export function chooseLeastLoadedStaffId(staffIds: readonly number[], loads: ReadonlyMap<number, number>): number | null {
  let selectedId: number | null = null
  for (const id of staffIds) {
    const load = loads.get(id) ?? 0
    const selectedLoad = selectedId === null ? Number.POSITIVE_INFINITY : loads.get(selectedId) ?? 0
    if (load < selectedLoad || (load === selectedLoad && (selectedId === null || id < selectedId))) {
      selectedId = id
    }
  }
  return selectedId
}

export async function assignCollaborationDealToLeastLoadedStaff(
  transaction: Prisma.TransactionClient,
  dealId: number,
  role: SalesAssignmentRole,
  now = new Date(),
): Promise<number | null> {
  await transaction.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM users
    WHERE role = ${role} AND status = 'ACTIF' AND totp_enabled = 1
    ORDER BY id
    FOR UPDATE
  `

  const staff = await transaction.user.findMany({
    where: { role, status: 'ACTIF', totpEnabled: true },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  if (staff.length === 0) return null
  const staffIds = staff.map(({ id }) => id)

  let assignedToId: number | null
  if (role === 'SALES_REVIEWER') {
    const assignments = await transaction.collaborationDeal.groupBy({
      by: ['reviewAssignedToId'],
      where: {
        reviewAssignedToId: { in: staffIds },
        status: { in: reviewerEligibleStatuses() },
        closingReport: { is: { status: 'SUBMITTED' } },
      },
      _count: { _all: true },
    })
    const loads = new Map<number, number>()
    for (const assignment of assignments) {
      if (assignment.reviewAssignedToId !== null) loads.set(assignment.reviewAssignedToId, assignment._count._all)
    }
    assignedToId = chooseLeastLoadedStaffId(staffIds, loads)
  } else {
    const assignments = await transaction.collaborationDeal.groupBy({
      by: ['signAssignedToId'],
      where: {
        signAssignedToId: { in: staffIds },
        status: 'CONFIRMED',
        saleNumber: null,
        closingReport: { is: { status: 'SUBMITTED' } },
      },
      _count: { _all: true },
    })
    const loads = new Map<number, number>()
    for (const assignment of assignments) {
      if (assignment.signAssignedToId !== null) loads.set(assignment.signAssignedToId, assignment._count._all)
    }
    assignedToId = chooseLeastLoadedStaffId(staffIds, loads)
  }
  if (assignedToId === null) return null

  const update = await transaction.collaborationDeal.updateMany({
    where: role === 'SALES_REVIEWER'
      ? {
          id: dealId,
          reviewAssignedToId: null,
          status: { in: reviewerEligibleStatuses() },
          closingReport: { is: { status: 'SUBMITTED' } },
        }
      : {
          id: dealId,
          signAssignedToId: null,
          status: 'CONFIRMED',
          saleNumber: null,
          closingReport: { is: { status: 'SUBMITTED' } },
        },
    data: role === 'SALES_REVIEWER'
      ? { reviewAssignedToId: assignedToId }
      : { signAssignedToId: assignedToId },
  })
  if (update.count !== 1) return null

  await writeCollaborationAudit(transaction, {
    dealId,
    action: 'COLLABORATION_DEAL_AUTO_ASSIGNED',
    entityType: 'CollaborationDeal',
    entityId: dealId,
    metadata: { role, assignedToId },
    newValues: role === 'SALES_REVIEWER'
      ? { reviewAssignedToId: assignedToId }
      : { signAssignedToId: assignedToId },
    actorRole: 'SYSTEM',
    createdAt: now,
  })
  return assignedToId
}

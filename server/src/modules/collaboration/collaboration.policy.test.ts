import assert from 'node:assert/strict'
import test from 'node:test'
import type { CollaborationAccessStatus, CollaborationDealStatus } from '@prisma/client'
import {
  canRequestCollaborationAccess,
  canSignCollaborationDeal,
  canSubmitCollaborationClosing,
  canTransitionCollaborationDeal,
  canViewCollaborationDeal,
  isSignedCollaborationStatus,
} from './collaboration.policy.js'

const now = new Date('2026-11-04T12:00:00.000Z')
type AccessSnapshot = { status: CollaborationAccessStatus; decidedAt: Date | null }
type AccessRequestSnapshot = AccessSnapshot & { requesterId: number }
const activeCloserAccess: AccessRequestSnapshot[] = [{ requesterId: 2, status: 'APPROVED', decidedAt: new Date('2026-11-04T10:00:00.000Z') }]

function makeDeal(overrides: Partial<{
  supplierId: number
  closerId: number | null
  status: CollaborationDealStatus
  accessGrantedAt: Date | null
  accessExpiresAt: Date | null
  accessRequests: AccessRequestSnapshot[]
}> = {}) {
  return {
    id: 8,
    supplierId: 1,
    closerId: 2,
    status: 'IN_PROGRESS' as CollaborationDealStatus,
    accessGrantedAt: new Date('2026-11-04T09:00:00.000Z'),
    accessExpiresAt: new Date('2026-11-18T09:00:00.000Z'),
    accessRequests: activeCloserAccess,
    ...overrides,
  }
}

test('supplier and only the active approved closer can read deal details', () => {
  assert.equal(canViewCollaborationDeal({ id: 1, role: 'AGENT', status: 'ACTIF' }, makeDeal(), now), true)
  assert.equal(canViewCollaborationDeal({ id: 2, role: 'AGENT', status: 'ACTIF' }, makeDeal(), now), true)
  assert.equal(canViewCollaborationDeal({ id: 3, role: 'AGENT', status: 'ACTIF' }, makeDeal(), now), false)
  assert.equal(canViewCollaborationDeal(
    { id: 2, role: 'AGENT', status: 'ACTIF' },
    makeDeal({ accessRequests: [{ requesterId: 2, status: 'PENDING', decidedAt: null }] }),
    now,
  ), false)
})

test('inactive or expired closer access does not authorize detail access or closing reports', () => {
  const actor = { id: 2, role: 'AGENT' as const, status: 'ACTIF' }
  const expiredDeal = makeDeal({ accessExpiresAt: new Date('2026-11-04T11:59:59.000Z') })
  assert.equal(canViewCollaborationDeal(actor, expiredDeal, now), false)
  assert.equal(canSubmitCollaborationClosing(actor, expiredDeal, now), false)
  assert.equal(canViewCollaborationDeal({ ...actor, status: 'SUSPENDU' }, makeDeal(), now), false)
  assert.equal(canSubmitCollaborationClosing(actor, makeDeal({
    accessRequests: [{ requesterId: 2, status: 'REVOKED', decidedAt: new Date('2026-11-04T10:00:00.000Z') }],
  }), now), false)
  assert.equal(canSubmitCollaborationClosing(actor, makeDeal({ closerId: 4 }), now), false)
})

test('agents cannot request access to their own prospect', () => {
  assert.equal(
    canRequestCollaborationAccess({ id: 1, role: 'AGENT', status: 'ACTIF' }, makeDeal({ status: 'DECLARED' })),
    false,
  )
  assert.equal(
    canRequestCollaborationAccess({ id: 3, role: 'AGENT', status: 'ACTIF' }, makeDeal({ status: 'DECLARED' })),
    true,
  )
  assert.equal(
    canRequestCollaborationAccess({ id: 3, role: 'AGENT', status: 'ACTIF' }, makeDeal({ status: 'EXPIRED' })),
    true,
  )
  assert.equal(
    canRequestCollaborationAccess({ id: 3, role: 'AGENT', status: 'ACTIF' }, makeDeal({ status: 'LOST' })),
    true,
  )
})

test('lost and expired deals can be requested again', () => {
  assert.equal(canTransitionCollaborationDeal({ role: 'SYSTEM' }, makeDeal(), 'EXPIRED', now), true)
  for (const status of ['EXPIRED', 'LOST'] as const) {
    assert.equal(canTransitionCollaborationDeal(
      { id: 3, role: 'AGENT', status: 'ACTIF' },
      makeDeal({ status }),
      'ACCESS_REQUESTED',
      now,
    ), true)
  }
})

test('signed deal statuses are distinct from requestable and closable states', () => {
  const closer = { id: 2, role: 'AGENT' as const, status: 'ACTIF' }
  assert.equal(isSignedCollaborationStatus('CONTRACT_SIGNED'), true)
  assert.equal(isSignedCollaborationStatus('COMMISSIONS_PAID'), true)
  assert.equal(isSignedCollaborationStatus('LOST'), false)
  for (const status of ['CONTRACT_SIGNED', 'COMMISSIONS_PAID'] as const) {
    assert.equal(canRequestCollaborationAccess({ id: 3, role: 'AGENT', status: 'ACTIF' }, makeDeal({ status })), false)
    assert.equal(canSubmitCollaborationClosing(closer, makeDeal({ status }), now), false)
  }
})

test('a deal cannot start until the supplier approves the assigned closer', () => {
  const supplier = { id: 1, role: 'AGENT' as const, status: 'ACTIF' }
  const deal = makeDeal({ status: 'ACCESS_REQUESTED', accessGrantedAt: null, accessExpiresAt: null })
  assert.equal(canTransitionCollaborationDeal(supplier, deal, 'IN_PROGRESS', now), true)
  assert.equal(canTransitionCollaborationDeal(supplier, {
    ...deal,
    accessRequests: [{ requesterId: 3, status: 'APPROVED', decidedAt: now }],
  }, 'IN_PROGRESS', now), false)
  assert.equal(canTransitionCollaborationDeal({ id: 4, role: 'ADMIN', status: 'ACTIF' }, {
    ...deal,
    accessRequests: [],
  }, 'IN_PROGRESS', now), false)
})

test('only an administrator can confirm a client-confirmed deal', () => {
  const deal = makeDeal({ status: 'CLIENT_CONFIRMED' })
  assert.equal(
    canTransitionCollaborationDeal({ id: 2, role: 'AGENT', status: 'ACTIF' }, deal, 'CONFIRMED', now),
    false,
  )
  assert.equal(
    canTransitionCollaborationDeal({ id: 4, role: 'ADMIN', status: 'ACTIF' }, deal, 'CONFIRMED', now),
    true,
  )
  assert.equal(
    canTransitionCollaborationDeal({ id: 4, role: 'ADMIN', status: 'SUSPENDU' }, deal, 'CONFIRMED', now),
    false,
  )
})

test('only an administrator can confirm a submitted closing report', () => {
  const deal = makeDeal({ status: 'CLOSING_REPORTED' })
  assert.equal(
    canTransitionCollaborationDeal({ id: 2, role: 'AGENT', status: 'ACTIF' }, deal, 'CONFIRMED', now),
    false,
  )
  assert.equal(
    canTransitionCollaborationDeal({ id: 4, role: 'ADMIN', status: 'ACTIF' }, deal, 'CONFIRMED', now),
    true,
  )
  assert.equal(
    canTransitionCollaborationDeal({ id: 4, role: 'ADMIN', status: 'SUSPENDU' }, deal, 'CONFIRMED', now),
    false,
  )
})

test('a client denial automatically allows the system to dispute the closing', () => {
  const deal = makeDeal({ status: 'CLOSING_REPORTED' })
  assert.equal(canTransitionCollaborationDeal({ role: 'SYSTEM' }, deal, 'DISPUTED', now), true)
  assert.equal(
    canTransitionCollaborationDeal({ id: 2, role: 'AGENT', status: 'ACTIF' }, deal, 'DISPUTED', now),
    false,
  )
})

test('only an active approved closer can submit a closing report or declare lost', () => {
  const closer = { id: 2, role: 'AGENT' as const, status: 'ACTIF' }
  const deal = makeDeal()
  assert.equal(canTransitionCollaborationDeal(closer, deal, 'CLOSING_REPORTED', now), true)
  assert.equal(canTransitionCollaborationDeal(closer, deal, 'LOST', now), true)
  assert.equal(canTransitionCollaborationDeal(
    { ...closer, id: 3 },
    deal,
    'CLOSING_REPORTED',
    now,
  ), false)
})

test('a closer cannot confirm or sign a collaboration deal', () => {
  const closer = { id: 2, role: 'AGENT' as const, status: 'ACTIF' }
  const deal = makeDeal({ status: 'CLOSING_REPORTED' })
  assert.equal(canTransitionCollaborationDeal(closer, deal, 'CONFIRMED', now), false)
  assert.equal(canTransitionCollaborationDeal(closer, deal, 'CONTRACT_SIGNED', now), false)
})

test('contract signature requires admin confirmation, submitted report, and client confirmation when configured', () => {
  const valid = {
    dealStatus: 'CONFIRMED' as const,
    saleNumber: null,
    closingReportStatus: 'SUBMITTED' as const,
    confirmationRequired: true,
    confirmationStatus: 'CONFIRMED_BY_CLIENT',
    confirmationOverridden: false,
  }
  assert.equal(canSignCollaborationDeal(valid), true)
  assert.equal(canSignCollaborationDeal({ ...valid, confirmationStatus: 'NO_RESPONSE' }), false)
  assert.equal(canSignCollaborationDeal({ ...valid, confirmationStatus: 'NO_RESPONSE', confirmationOverridden: true }), true)
  assert.equal(canSignCollaborationDeal({ ...valid, saleNumber: 'TSN-opaque' }), false)
  assert.equal(canSignCollaborationDeal({ ...valid, closingReportStatus: 'DRAFT' }), false)
  assert.equal(canSignCollaborationDeal({ ...valid, dealStatus: 'IN_PROGRESS' }), false)
})

test('invalid lifecycle transitions are rejected', () => {
  assert.equal(
    canTransitionCollaborationDeal(
      { id: 4, role: 'ADMIN', status: 'ACTIF' },
      makeDeal({ status: 'DECLARED' }),
      'CONTRACT_SIGNED',
      now,
    ),
    false,
  )
})

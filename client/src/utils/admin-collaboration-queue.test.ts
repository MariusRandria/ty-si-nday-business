import assert from 'node:assert/strict'
import test from 'node:test'
import { sortAdminCollaborationDeals } from './admin-collaboration-queue.ts'

test('collaboration review queue prioritizes disputes and visible overrides', () => {
  const deals = [
    { id: 1, status: 'CLOSING_REPORTED', closingReportedAt: null, updatedAt: '2026-01-01', supplier: null, closer: null },
    { id: 2, status: 'DISPUTED', closingReportedAt: null, updatedAt: '2026-03-01', supplier: null, closer: null },
    { id: 3, status: 'CONFIRMED_BY_CLIENT', closingReportedAt: null, updatedAt: '2026-02-01', clientConfirmationOverrideReason: 'Validation documentée', supplier: null, closer: null },
  ]

  assert.deepEqual(sortAdminCollaborationDeals(deals).map(({ id }) => id), [2, 3, 1])
})

test('ordinary review deals retain stable oldest-first ordering', () => {
  const deals = [
    { id: 3, status: 'CLOSING_REPORTED', closingReportedAt: null, updatedAt: '2026-02-01', supplier: null, closer: null },
    { id: 2, status: 'NO_RESPONSE', closingReportedAt: null, updatedAt: '2026-01-01', supplier: null, closer: null },
    { id: 1, status: 'CLOSING_REPORTED', closingReportedAt: null, updatedAt: '2026-01-01', supplier: null, closer: null },
  ]

  assert.deepEqual(sortAdminCollaborationDeals(deals).map(({ id }) => id), [1, 2, 3])
})

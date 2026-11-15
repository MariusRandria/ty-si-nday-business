import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAdminCollaborationDealsWhere,
  buildAdminCollaborationReadyToSignWhere,
  buildAdminSignedContractsWhere,
  parseAdminCollaborationFilters,
  parseAdminSignedContractsFilters,
} from './collaboration.admin.read-queries.js'

test('parses valid stage, assignment, and date filters for workflow queues', () => {
  const parsed = parseAdminCollaborationFilters({
    from: '2026-11-01T00:00:00.000Z',
    to: '2026-11-15T20:59:59.999Z',
    assignment: 'UNASSIGNED',
    reviewStage: 'CLIENT_CONFIRMED',
  })

  assert.ok(parsed.filters)
  assert.equal(parsed.filters.assignment, 'UNASSIGNED')
  assert.equal(parsed.filters.reviewStage, 'CLIENT_CONFIRMED')
  assert.equal(parsed.filters.from?.toISOString(), '2026-11-01T00:00:00.000Z')
})

test('rejects unknown workflow filters and reversed dates', () => {
  assert.equal(parseAdminCollaborationFilters({ assignment: 'EVERYONE' }).filters, null)
  assert.equal(parseAdminCollaborationFilters({ reviewStage: 'SIGNED' }).filters, null)
  assert.equal(parseAdminCollaborationFilters({ sla: 'ON_TIME' }).filters, null)
  assert.equal(parseAdminCollaborationFilters({ from: '2026-11-15', to: '2026-11-01' }).filters, null)
})

test('accepts the overdue-only filter used to prioritize workflow queues', () => {
  const parsed = parseAdminCollaborationFilters({ sla: 'OVERDUE' })
  assert.ok(parsed.filters)
  assert.equal(parsed.filters.sla, 'OVERDUE')
})

test('applies review stage and assignment filters in the database query', () => {
  const parsed = parseAdminCollaborationFilters({
    assignment: 'UNASSIGNED',
    reviewStage: 'CLIENT_CONFIRMED',
  })
  assert.ok(parsed.filters)

  const where = buildAdminCollaborationDealsWhere(parsed.filters)
  assert.deepEqual(where.status, { in: ['CONFIRMED_BY_CLIENT', 'CLIENT_CONFIRMED'] })
  assert.equal(where.reviewAssignedToId, null)
})

test('applies signer assignment filters without changing the ready-to-sign status', () => {
  const parsed = parseAdminCollaborationFilters({ assignment: 'ASSIGNED' })
  assert.ok(parsed.filters)

  const where = buildAdminCollaborationReadyToSignWhere(parsed.filters)
  assert.equal(where.status, 'CONFIRMED')
  assert.deepEqual(where.signAssignedToId, { not: null })
})

test('validates signed-contract search, status, and signed-date filters', () => {
  const parsed = parseAdminSignedContractsFilters({
    q: '  ACME  ',
    status: 'COMMISSIONS_PAID',
    from: '2026-11-01T00:00:00.000Z',
    to: '2026-11-15T20:59:59.999Z',
  })
  assert.ok(parsed.filters)
  assert.equal(parsed.filters.q, 'ACME')
  assert.equal(parsed.filters.status, 'COMMISSIONS_PAID')
  assert.equal(parseAdminSignedContractsFilters({ status: 'PENDING' }).filters, null)
  assert.equal(parseAdminSignedContractsFilters({ q: 'x'.repeat(101) }).filters, null)
})

test('builds a signed-contract query that searches dossier, sale, client, and project fields', () => {
  const parsed = parseAdminSignedContractsFilters({ q: '42' })
  assert.ok(parsed.filters)
  const where = buildAdminSignedContractsWhere(parsed.filters)

  assert.deepEqual(where.contractSignedAt, { not: null })
  assert.deepEqual(where.saleNumber, { not: null })
  assert.ok(Array.isArray(where.OR))
  assert.ok(where.OR.some((condition) => 'id' in condition && condition.id === 42))
})

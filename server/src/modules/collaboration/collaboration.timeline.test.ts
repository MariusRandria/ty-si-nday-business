import assert from 'node:assert/strict'
import test from 'node:test'
import { serializeSupplierCollaborationTimeline } from './collaboration.timeline.js'

test('supplier timeline exposes only lifecycle labels and dates', () => {
  const result = serializeSupplierCollaborationTimeline({
    id: 9,
    status: 'CONTRACT_SIGNED',
    declaredAt: new Date('2026-11-01T10:00:00.000Z'),
    accessGrantedAt: new Date('2026-11-02T10:00:00.000Z'),
    accessExpiresAt: new Date('2026-11-16T10:00:00.000Z'),
    closingReportedAt: new Date('2026-11-03T10:00:00.000Z'),
    clientConfirmedAt: new Date('2026-11-04T10:00:00.000Z'),
    confirmedAt: new Date('2026-11-04T11:00:00.000Z'),
    contractSignedAt: new Date('2026-11-04T12:00:00.000Z'),
    saleNumber: 'TSN-2026-OPAQUE',
    statusHistory: [{ toStatus: 'CONTRACT_SIGNED', createdAt: new Date('2026-11-04T12:00:00.000Z') }],
  })
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes('saleAmount'), false)
  assert.equal(serialized.includes('contactPhone'), false)
  assert.equal(serialized.includes('contactEmail'), false)
  assert.equal(serialized.includes('companyName'), false)
  assert.equal(result.steps[0].status, 'DECLARED')
  assert.equal(result.saleNumber, 'TSN-2026-OPAQUE')
})

test('supplier timeline never exposes a sale number before contract signature', () => {
  const result = serializeSupplierCollaborationTimeline({
    id: 10,
    status: 'CONFIRMED',
    declaredAt: new Date('2026-11-01T10:00:00.000Z'),
    accessGrantedAt: null,
    accessExpiresAt: null,
    closingReportedAt: null,
    clientConfirmedAt: null,
    confirmedAt: new Date('2026-11-04T11:00:00.000Z'),
    contractSignedAt: null,
    saleNumber: 'MUST-NOT-BE-EXPOSED',
    statusHistory: [],
  })
  assert.equal('saleNumber' in result, false)
})

test('supplier timeline only exposes a sale number for signed lifecycle statuses', () => {
  const result = serializeSupplierCollaborationTimeline({
    id: 11,
    status: 'IN_PROGRESS',
    declaredAt: new Date('2026-11-01T10:00:00.000Z'),
    accessGrantedAt: null,
    accessExpiresAt: null,
    closingReportedAt: null,
    clientConfirmedAt: null,
    confirmedAt: null,
    contractSignedAt: new Date('2026-11-04T11:00:00.000Z'),
    saleNumber: 'MUST-NOT-BE-EXPOSED',
    statusHistory: [],
  })
  assert.equal('saleNumber' in result, false)
})

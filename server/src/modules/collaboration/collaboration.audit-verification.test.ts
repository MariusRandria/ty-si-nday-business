import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAuditChainVerificationStatus } from './collaboration.audit-verification.js'

const now = new Date('2026-11-06T12:00:00.000Z')

test('audit verification status is UNKNOWN when absent or malformed', () => {
  assert.equal(parseAuditChainVerificationStatus(null, now).status, 'UNKNOWN')
  assert.equal(parseAuditChainVerificationStatus('not-json', now).status, 'UNKNOWN')
  assert.equal(parseAuditChainVerificationStatus(JSON.stringify({
    status: 'VALID',
    checkedAt: '2026-11-06T11:00:00.000Z',
    sequence: 'not-a-sequence',
    issueCount: 0,
  }), now).status, 'UNKNOWN')
})

test('audit verification status distinguishes fresh valid and broken results', () => {
  const verifiedAt = '2026-11-06T11:00:00.000Z'
  const valid = parseAuditChainVerificationStatus(JSON.stringify({
    status: 'VALID',
    checkedAt: verifiedAt,
    sequence: '42',
    issueCount: 0,
  }), now)
  const broken = parseAuditChainVerificationStatus(JSON.stringify({
    status: 'BROKEN',
    checkedAt: verifiedAt,
    sequence: '42',
    issueCount: 2,
  }), now)

  assert.deepEqual(valid, {
    status: 'VALID',
    lastResult: 'VALID',
    checkedAt: verifiedAt,
    sequence: '42',
    issueCount: 0,
  })
  assert.equal(broken.status, 'BROKEN')
  assert.equal(broken.issueCount, 2)
})

test('audit verification status is STALE after 36 hours and retains last result', () => {
  const stale = parseAuditChainVerificationStatus(JSON.stringify({
    status: 'VALID',
    checkedAt: '2026-11-04T23:59:59.999Z',
    sequence: '42',
    issueCount: 0,
  }), now)

  assert.equal(stale.status, 'STALE')
  assert.equal(stale.lastResult, 'VALID')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateTrustScore } from './collaboration.trust-score.js'

test('trust score follows the documented weighted formula and caps components', () => {
  const result = calculateTrustScore({
    concludedDeals: 8,
    resolvedDeals: 10,
    lostDisputes: 0,
    averageReportDelayHours: 24,
    repeatedExpirations: 1,
    accountAgeDays: 365,
  })
  assert.equal(result.score, 89)
  assert.equal(result.components.completionPoints, 32)
  assert.equal(result.components.disputePoints, 25)
  assert.equal(result.components.expiryPoints, 8)
  assert.equal(result.components.tenurePoints, 5)
})

test('trust score applies maximum penalties and neutral delay for an agent without reports', () => {
  const result = calculateTrustScore({
    concludedDeals: 0,
    resolvedDeals: 0,
    lostDisputes: 5,
    averageReportDelayHours: null,
    repeatedExpirations: 10,
    accountAgeDays: 0,
  })
  assert.equal(result.score, 10)
  assert.equal(result.components.disputePoints, 0)
  assert.equal(result.components.reportSpeedPoints, 10)
  assert.equal(result.components.expiryPoints, 0)
})

test('trust score rejects inconsistent or negative inputs', () => {
  assert.throws(() => calculateTrustScore({
    concludedDeals: 2,
    resolvedDeals: 1,
    lostDisputes: 0,
    averageReportDelayHours: 0,
    repeatedExpirations: 0,
    accountAgeDays: 0,
  }))
  assert.throws(() => calculateTrustScore({
    concludedDeals: 0,
    resolvedDeals: 0,
    lostDisputes: 0,
    averageReportDelayHours: -1,
    repeatedExpirations: 0,
    accountAgeDays: 0,
  }))
})

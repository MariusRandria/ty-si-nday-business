import assert from 'node:assert/strict'
import test from 'node:test'
import {
  amountForCommissionRole,
  canResolveHeldCommission,
  disputeResolutionStatus,
  hasExactlyExpectedCommissionRecipients,
  isCommissionGenerationReady,
  shouldCompleteCommissionsPaid,
  validateCommissionConfig,
} from './collaboration.commissions.policy.js'

const config = validateCommissionConfig({
  providerAmount: 50_000,
  closerAmount: 100_000,
  currency: 'Ar',
})

test('configured role amounts are snapshotted as integers and later configuration changes do not mutate them', () => {
  const generatedProviderAmount = amountForCommissionRole('SUPPLIER', config)
  const generatedCloserAmount = amountForCommissionRole('CLOSER', config)
  const changedConfig = validateCommissionConfig({
    ...config,
    providerAmount: 75_000,
    closerAmount: 125_000,
  })

  assert.equal(generatedProviderAmount, 50_000n)
  assert.equal(generatedCloserAmount, 100_000n)
  assert.equal(amountForCommissionRole('SUPPLIER', changedConfig), 75_000n)
  assert.equal(amountForCommissionRole('CLOSER', changedConfig), 125_000n)
  assert.equal(generatedProviderAmount, 50_000n)
})

test('commission generation requires a signed sale number and both assigned agents', () => {
  assert.equal(isCommissionGenerationReady({
    contractSignedAt: new Date('2026-11-05T00:00:00Z'),
    saleNumber: 'TSN-2026-ABC',
    closerId: 12,
  }), true)
  assert.equal(isCommissionGenerationReady({ contractSignedAt: null, saleNumber: 'TSN-2026-ABC', closerId: 12 }), false)
  assert.equal(isCommissionGenerationReady({ contractSignedAt: new Date(), saleNumber: null, closerId: 12 }), false)
  assert.equal(isCommissionGenerationReady({ contractSignedAt: new Date(), saleNumber: 'TSN-2026-ABC', closerId: null }), false)
})

test('signed sale reconciliation requires exactly the expected supplier and closer commissions', () => {
  assert.equal(hasExactlyExpectedCommissionRecipients([
    { role: 'SUPPLIER', agentId: 8 },
    { role: 'CLOSER', agentId: 12 },
  ], 8, 12), true)
  assert.equal(hasExactlyExpectedCommissionRecipients([
    { role: 'SUPPLIER', agentId: 8 },
  ], 8, 12), false)
  assert.equal(hasExactlyExpectedCommissionRecipients([
    { role: 'SUPPLIER', agentId: 8 },
    { role: 'CLOSER', agentId: 15 },
  ], 8, 12), false)
})

test('commission resolution rejects terminal state changes', () => {
  assert.equal(canResolveHeldCommission('PENDING'), true)
  assert.equal(canResolveHeldCommission('ON_HOLD'), true)
  assert.equal(canResolveHeldCommission('PAID'), false)
  assert.equal(canResolveHeldCommission('CANCELLED'), false)
})

test('the deal is complete only after both commissions have been paid', () => {
  assert.equal(shouldCompleteCommissionsPaid(['PAID', 'PAID']), true)
  assert.equal(shouldCompleteCommissionsPaid(['PAID', 'PENDING']), false)
  assert.equal(shouldCompleteCommissionsPaid(['PAID', 'CANCELLED']), false)
  assert.equal(shouldCompleteCommissionsPaid(['PAID']), false)
})

test('disputes can only be resolved after both commissions are no longer pending or held', () => {
  assert.equal(disputeResolutionStatus(['PAID', 'PAID']), 'COMMISSIONS_PAID')
  assert.equal(disputeResolutionStatus(['PAID', 'CANCELLED']), 'CONTRACT_SIGNED')
  assert.equal(disputeResolutionStatus(['PAID', 'PENDING']), null)
  assert.equal(disputeResolutionStatus(['CANCELLED', 'ON_HOLD']), null)
  assert.equal(disputeResolutionStatus(['PAID']), null)
})

test('commission amounts must come from valid configuration', () => {
  assert.throws(() => validateCommissionConfig({ ...config, providerAmount: 0 }))
  assert.throws(() => validateCommissionConfig({ ...config, closerAmount: Number.MAX_SAFE_INTEGER + 1 }))
})

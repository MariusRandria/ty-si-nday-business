import assert from 'node:assert/strict'
import test from 'node:test'
import type { MarketplaceDeliveryMethod, MarketplaceOrderStatus, MarketplacePaymentMethod } from '@prisma/client'
import {
  calculateMarketplaceOrderTotal,
  canTransitionMarketplaceOrder,
  marketplaceDeliveryRequiresAddress,
  marketplaceOrderCanPayWithoutDeadline,
  marketplacePaymentExpiry,
  marketplacePaymentMethodAllowed,
} from './marketplace.policy.js'

test('marketplace orders allow only forward workflow transitions', () => {
  assert.equal(canTransitionMarketplaceOrder('DEMANDEE', 'CONFIRMEE'), true)
  assert.equal(canTransitionMarketplaceOrder('PRETE', 'EXPEDIEE'), true)
  assert.equal(canTransitionMarketplaceOrder('DEMANDEE', 'LIVREE'), false)
  assert.equal(canTransitionMarketplaceOrder('LIVREE', 'ANNULEE'), false)
})

test('marketplace delivery requires an address except for collection', () => {
  assert.equal(marketplaceDeliveryRequiresAddress('LIVRAISON' satisfies MarketplaceDeliveryMethod), true)
  assert.equal(marketplaceDeliveryRequiresAddress('COLIS' satisfies MarketplaceDeliveryMethod), true)
  assert.equal(marketplaceDeliveryRequiresAddress('RECUPERATION' satisfies MarketplaceDeliveryMethod), false)
})

test('marketplace order total uses integer arithmetic', () => {
  assert.equal(calculateMarketplaceOrderTotal([
    { unitPrice: 125_000n, quantity: 2 },
    { unitPrice: 37_500n, quantity: 1 },
  ]), 287_500n)
  assert.equal(calculateMarketplaceOrderTotal([
    { unitPrice: 125_000n, quantity: 2 },
  ], 15_000n), 265_000n)
})

test('cash payment is only available for collection', () => {
  assert.equal(marketplacePaymentMethodAllowed('RECUPERATION' satisfies MarketplaceDeliveryMethod, 'ESPECES' satisfies MarketplacePaymentMethod), true)
  assert.equal(marketplacePaymentMethodAllowed('LIVRAISON' satisfies MarketplaceDeliveryMethod, 'ESPECES' satisfies MarketplacePaymentMethod), false)
  assert.equal(marketplacePaymentMethodAllowed('COLIS' satisfies MarketplaceDeliveryMethod, 'MVOLA' satisfies MarketplacePaymentMethod), true)
})

test('marketplace payment deadline is exactly 24 hours after its start', () => {
  const startedAt = new Date('2026-11-15T12:00:00.000Z')
  assert.equal(marketplacePaymentExpiry(startedAt).toISOString(), '2026-11-16T12:00:00.000Z')
})

test('already shipped or delivered legacy orders are not blocked by a missing payment deadline', () => {
  assert.equal(marketplaceOrderCanPayWithoutDeadline('EXPEDIEE'), true)
  assert.equal(marketplaceOrderCanPayWithoutDeadline('LIVREE'), true)
  assert.equal(marketplaceOrderCanPayWithoutDeadline('DEMANDEE'), false)
})
